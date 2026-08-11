from pycsdr.modules import ExecModule
from pycsdr.types import Format
from csdr.module import PopenModule
from owrx.config import Config
from threading import Thread
import logging
import os
import re
import time
import uuid

logger = logging.getLogger(__name__)
ANSI_ESCAPE_RE = re.compile(r"\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])")


class Rtl433Module(ExecModule):
    def __init__(self, sampleRate: int = 250000, jsonOutput: bool = False):
        cmd = [
            "rtl_433", "-r", "cf32:-", "-s", str(sampleRate),
            "-M", "time:unix" if jsonOutput else "time:utc",
            "-F", "json" if jsonOutput else "kv",
            "-A", "-Y", "autolevel",
        ]
        pm = Config.get()
        if pm["ism_report_levels"]:
            cmd += ["-M", "level"]
        super().__init__(Format.COMPLEX_FLOAT, Format.CHAR, cmd)


class MultimonModule(ExecModule):
    def __init__(self, decoders: list[str]):
        pm  = Config.get()
        cmd = ["multimon-ng", "-", "-v0", "-C", pm["paging_charset"], "-c"]
        for x in decoders:
            cmd += ["-a", x]
        super().__init__(Format.SHORT, Format.CHAR, cmd)


class WavFileModule(PopenModule):
    def getInputFormat(self) -> Format:
        return Format.SHORT

    def start(self):
        # Create process and pumps
        super().start()
        # Created simulated .WAV file header
        byteRate = (self.sampleRate * 16 * 1) >> 3
        header = bytearray(44)
        header[0:3]   = b"RIFF"
        header[4:7]   = bytes([36, 0xFF, 0xFF, 0xFF])
        header[8:11]  = b"WAVE"
        header[12:15] = b"fmt "
        header[16]    = 16       # Chunk size
        header[20]    = 1        # Format (PCM)
        header[22]    = 1        # Number of channels (1)
        header[24]    = self.sampleRate & 0xFF
        header[25]    = (self.sampleRate >> 8) & 0xFF
        header[26]    = (self.sampleRate >> 16) & 0xFF
        header[27]    = (self.sampleRate >> 24) & 0xFF
        header[28]    = byteRate & 0xFF
        header[29]    = (byteRate >> 8) & 0xFF
        header[30]    = (byteRate >> 16) & 0xFF
        header[31]    = (byteRate >> 24) & 0xFF
        header[32]    = 2       # Block alignment (2 bytes)
        header[34]    = 16      # Bits per sample (16)
        header[36:39] = b"data"
        header[40:43] = bytes([0, 0xFF, 0xFF, 0xFF])
        # Send .WAV file header to the process
        self.process.stdin.write(header)


class CwSkimmerModule(ExecModule):
    def __init__(self, sampleRate: int = 96000, charCount: int = 4):
        cmd = ["csdr-cwskimmer", "-f", "-r", str(sampleRate), "-n", str(charCount)]
        super().__init__(Format.FLOAT, Format.CHAR, cmd)


class RttySkimmerModule(ExecModule):
    def __init__(self, sampleRate: int = 96000, charCount: int = 4):
        cmd = ["csdr-rttyskimmer", "-f", "-r", str(sampleRate), "-n", str(charCount)]
        super().__init__(Format.FLOAT, Format.CHAR, cmd)


class RedseaModule(ExecModule):
    def __init__(self, sampleRate: int = 171000, rbds: bool = False):
        cmd = [ "redsea", "--input", "mpx", "--samplerate", str(sampleRate) ]
        if rbds:
            cmd += ["--rbds"]
        super().__init__(Format.SHORT, Format.CHAR, cmd)


class DablinModule(ExecModule):
    def __init__(self, formatCallback=None):
        self.serviceId = 0
        self.formatCallback = formatCallback
        self.details = {}
        self.subchannels = {}
        self.services = {}
        self.logPath = "/tmp/openwebrx-dablin-{}.log".format(uuid.uuid4().hex)
        self.tailRun = True
        super().__init__(
            Format.CHAR,
            Format.FLOAT,
            self._buildArgs()
        )
        Thread(target=self._tailLog, daemon=True).start()

    def _tailLog(self):
        position = 0
        while self.tailRun:
            try:
                size = os.path.getsize(self.logPath)
                if size < position:
                    position = 0
                with open(self.logPath, "r", encoding="utf-8", errors="replace") as log:
                    log.seek(position)
                    for line in log:
                        self._processLogLine(line.rstrip())
                    position = log.tell()
            except FileNotFoundError:
                position = 0
            time.sleep(.15)

    def _processLogLine(self, line):
            line = ANSI_ESCAPE_RE.sub("", line)
            logger.info("DABlin: %s", line)
            match = re.search(r"samplerate:\s*(\d+),\s*channels:\s*(\d+)", line)
            if match:
                self.details.update(sample_rate=int(match.group(1)), channels=int(match.group(2)))
            match = re.search(r"EId\s+0x([0-9A-Fa-f]+):\s+ensemble label '([^']+)'", line)
            if match:
                self.details.update(ensemble_id="0x" + match.group(1).upper(), ensemble_label=match.group(2))
            match = re.search(r"SId\s+0x([0-9A-Fa-f]+):\s+audio service \(SubChId\s+(\d+),\s*([^,]+),\s*([^\)]+)\)", line)
            if match:
                sid, sub = int(match.group(1), 16), int(match.group(2))
                self.services[sid] = {"service_id": "0x" + match.group(1).upper(), "subchannel": sub, "service_type": match.group(3), "component": match.group(4)}
            match = re.search(r"SubChId\s+(\d+):\s+start\s+(\d+)\s+CUs,\s+size\s+(\d+)\s+CUs,\s+PL\s+(.+?)\s+=\s+(\d+)\s+kBit/s", line)
            if match:
                self.subchannels[int(match.group(1))] = {"cu_start": int(match.group(2)), "cu_size": int(match.group(3)), "protection": match.group(4), "subchannel_bitrate": int(match.group(5))}
            match = re.search(r"playing sub-channel\s+(\d+)", line)
            if match:
                self.details["subchannel"] = int(match.group(1))
            match = re.search(r"format:\s+(.+?),\s+(\d+)\s+kHz\s+([^@]+?)\s+@\s+(\d+)\s+kBit/s", line)
            if match:
                self.details.update(codec=match.group(1), sample_rate=int(match.group(2)) * 1000, audio_mode=match.group(3).strip(), audio_bitrate=int(match.group(4)))
            selected = self.services.get(self.serviceId, {})
            self.details.update(selected)
            self.details.update(self.subchannels.get(self.details.get("subchannel"), {}))
            if self.formatCallback and (match or selected):
                self.formatCallback(self.details.get("sample_rate", 0), self.details.get("channels", 0), dict(self.details))

    def _buildArgs(self):
        return ["/usr/lib/python3/dist-packages/csdr/module/dablin-metadata-wrapper", self.logPath, "-I", "-p", "-s", "{:#06x}".format(self.serviceId)]

    def setDabServiceId(self, serviceId: int) -> None:
        self.serviceId = serviceId
        self.details = {"service_id": "0x{:04X}".format(serviceId)}
        self.setArgs(self._buildArgs())
        self.restart()

    def stop(self):
        self.tailRun = False
        try:
            os.remove(self.logPath)
        except FileNotFoundError:
            pass
        super().stop()


class LameModule(ExecModule):
    def __init__(self, sampleRate: int = 24000):
        cmd = [
            "lame", "-r", "-m", "m", "--signed", "--bitwidth", "16",
            "-s", str(sampleRate / 1000), "-b", "128", "-", "-"
        ]
        super().__init__(Format.SHORT, Format.CHAR, cmd)
