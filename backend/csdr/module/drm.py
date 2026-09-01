from pycsdr.modules import ExecModule
from pycsdr.types import Format

import os
import socket

class DrmModule(ExecModule):
    def __init__(self, socketPath: str = None):
        # Compose basic command line
        cmd = [
            "dream", "-c", "6", "--sigsrate", "48000",
            "--audsrate", "48000", "-I", "-", "-O", "-",
        ]

        self.socketPath = socketPath
        if self.socketPath:
            cmd += [ "--status-socket", self.socketPath ]

        super().__init__(Format.COMPLEX_SHORT, Format.SHORT, cmd)

    def setAudioServiceId(self, serviceId: int) -> None:
        if not self.socketPath:
            return
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as control:
                control.settimeout(0.5)
                control.connect(self.socketPath)
                control.sendall(("audio_service={0}\n".format(int(serviceId))).encode("ascii"))
        except (OSError, ValueError):
            pass

    def stop(self):
        # Stop execution
        super().stop()
        # Remove status socket
        if self.socketPath and os.path.exists(self.socketPath):
            try:
                os.unlink(self.socketPath)
            except OSError:
                pass
