from csdr.chain.demodulator import BaseDemodulatorChain, FixedIfSampleRateChain, HdAudio, \
    FixedAudioRateChain, DeemphasisTauChain, MetaProvider, RdsChain
from pycsdr.modules import AmDemod, DcBlock, FmDemod, Limit, NfmDeemphasis, Agc, Afc, \
    WfmDeemphasis, FractionalDecimator, StereoFractionalDecimator, RealPart, Writer, Buffer
from pycsdr.types import Format, AgcProfile
from csdr.chain.toolbox import RdsDemodulator
from csdr.module import ThreadModule
from typing import Optional
from owrx.feature import FeatureDetector
from threading import Event, Thread
from array import array
import pickle
import time
import math


class Am(BaseDemodulatorChain):
    def __init__(self, agcProfile: AgcProfile = AgcProfile.SLOW):
        agc = Agc(Format.FLOAT)
        agc.setProfile(agcProfile)
        agc.setInitialGain(200)
        workers = [
            AmDemod(),
            DcBlock(),
            agc,
        ]
        super().__init__(workers)


class NFm(BaseDemodulatorChain):
    def __init__(self, sampleRate: int, agcProfile: AgcProfile = AgcProfile.SLOW):
        self.sampleRate = sampleRate
        agc = Agc(Format.FLOAT)
        agc.setProfile(agcProfile)
        agc.setMaxGain(3)
        workers = [
            FmDemod(),
            Limit(),
            NfmDeemphasis(sampleRate),
            agc,
        ]
        super().__init__(workers)

    def setSampleRate(self, sampleRate: int) -> None:
        if sampleRate == self.sampleRate:
            return
        self.sampleRate = sampleRate
        self.replace(2, NfmDeemphasis(sampleRate))


class WFm(BaseDemodulatorChain, FixedIfSampleRateChain, DeemphasisTauChain, HdAudio, MetaProvider, RdsChain):
    def __init__(self, sampleRate: int, tau: float, rdsRbds: bool):
        self.sampleRate = sampleRate
        self.tau = tau
        self.rdsRbds = rdsRbds
        self.fmDemod = FmDemod()
        self.limit = Limit()
        # Tap the discriminator output before limiting, de-emphasis and stereo decoding.
        # FmDemod returns phase delta / pi, so 1.0 equals half the IF sample rate.
        self.deviationTapBuffer = Buffer(Format.FLOAT)
        # this buffer is used to tap into the raw audio stream for redsea RDS decoding
        self.metaTapBuffer = Buffer(Format.FLOAT)
        workers = [
            self.fmDemod,
            self.limit,
            StereoFractionalDecimator(
                Format.FLOAT, 200000.0, 200000.0 / self.sampleRate,
                self.tau, prefilter=True
            ),
        ]
        self.metaChain = None
        self.metaWriter = None
        self.deviationReader = None
        self.deviationThread = None
        self.deviationStop = Event()
        self.mpxFftSize = 1024
        self.mpxWindow = [
            0.5 - 0.5 * math.cos(2 * math.pi * index / (self.mpxFftSize - 1))
            for index in range(self.mpxFftSize)
        ]
        self.mpxWindowSum = sum(self.mpxWindow)
        super().__init__(workers)

    def _connect(self, w1, w2, buffer: Optional[Buffer] = None) -> None:
        if w1 is self.fmDemod:
            buffer = self.deviationTapBuffer
        elif w1 is self.limit:
            buffer = self.metaTapBuffer
        super()._connect(w1, w2, buffer)

    def _mpxSpectrum(self, samples) -> list:
        size = self.mpxFftSize
        values = [complex(samples[index] * self.mpxWindow[index], 0.0) for index in range(size)]
        target = 0
        for index in range(1, size):
            bit = size >> 1
            while target & bit:
                target ^= bit
                bit >>= 1
            target ^= bit
            if index < target:
                values[index], values[target] = values[target], values[index]
        length = 2
        while length <= size:
            angle = -2.0 * math.pi / length
            step = complex(math.cos(angle), math.sin(angle))
            half = length >> 1
            for start in range(0, size, length):
                rotation = 1.0 + 0.0j
                for offset in range(half):
                    even = values[start + offset]
                    odd = values[start + offset + half] * rotation
                    values[start + offset] = even + odd
                    values[start + offset + half] = even - odd
                    rotation *= step
            length <<= 1
        spectrum = []
        for frequency in range(0, 92001, 500):
            fftBin = min(size // 2, round(frequency * size / self.getFixedIfSampleRate()))
            amplitude = max(abs(values[fftBin]) * 2.0 / self.mpxWindowSum, 1e-6)
            db = 20.0 * math.log10(amplitude)
            spectrum.append(round(max(0.0, min(100.0, (db + 80.0) * 1.25))))
        return spectrum

    def _measureDeviation(self) -> None:
        magnitudes = []
        fftSamples = None
        nextReport = time.monotonic() + 0.25
        while not self.deviationStop.is_set():
            data = self.deviationReader.read()
            if data is None:
                break
            samples = memoryview(data).cast("f")
            if len(samples):
                # Subsample the MPX stream; the 99.5th percentile rejects isolated
                # discriminator phase jumps that would pin an absolute peak meter.
                magnitudes.extend(abs(samples[index]) for index in range(0, len(samples), 8))
                if len(samples) >= self.mpxFftSize:
                    fftSamples = [samples[index] for index in range(len(samples) - self.mpxFftSize, len(samples))]
            now = time.monotonic()
            if now >= nextReport:
                writer = self.metaWriter
                if writer is not None and magnitudes:
                    magnitudes.sort()
                    robustPeak = magnitudes[int((len(magnitudes) - 1) * 0.995)]
                    deviation = min(75.0, robustPeak * self.getFixedIfSampleRate() / 2000.0)
                    metadata = {"mode": "WFM", "deviation": deviation}
                    if fftSamples is not None:
                        metadata["mpxSpectrum"] = self._mpxSpectrum(fftSamples)
                    writer.write(pickle.dumps(metadata))
                magnitudes.clear()
                nextReport = now + 0.25

    def _startDeviationMeter(self) -> None:
        if self.deviationThread is not None:
            return
        self.deviationStop.clear()
        self.deviationReader = self.deviationTapBuffer.getReader()
        self.deviationThread = Thread(target=self._measureDeviation, daemon=True)
        self.deviationThread.start()

    def _stopDeviationMeter(self) -> None:
        self.deviationStop.set()
        if self.deviationReader is not None:
            self.deviationReader.stop()
        if self.deviationThread is not None:
            self.deviationThread.join(timeout=1)
        self.deviationReader = None
        self.deviationThread = None

    def getFixedIfSampleRate(self):
        return 200000

    def setDeemphasisTau(self, tau: float) -> None:
        if tau == self.tau:
            return
        self.tau = tau
        self.replace(2, StereoFractionalDecimator(
            Format.FLOAT, 200000.0, 200000.0 / self.sampleRate,
            self.tau, prefilter=True
        ))

    def setSampleRate(self, sampleRate: int) -> None:
        if sampleRate == self.sampleRate:
            return
        self.sampleRate = sampleRate
        self.replace(2, StereoFractionalDecimator(
            Format.FLOAT, 200000.0, 200000.0 / self.sampleRate,
            self.tau, prefilter=True
        ))

    def setMetaWriter(self, writer: Writer) -> None:
        if not FeatureDetector().is_available("rds"):
            return
        if self.metaChain is None:
            self.metaChain = RdsDemodulator(self.getFixedIfSampleRate(), self.rdsRbds)
            self.metaChain.setReader(self.metaTapBuffer.getReader())
        self.metaWriter = writer
        self.metaChain.setWriter(self.metaWriter)
        self._startDeviationMeter()

    def stop(self):
        self._stopDeviationMeter()
        super().stop()
        if self.metaChain is not None:
            self.metaChain.stop()
            self.metaChain = None
            self.metaWriter = None

    def setRdsRbds(self, rdsRbds: bool) -> None:
        self.rdsRbds = rdsRbds
        if self.metaChain is not None:
            self.metaChain.stop()
            self.metaChain = RdsDemodulator(self.getFixedIfSampleRate(), self.rdsRbds)
            self.metaChain.setReader(self.metaTapBuffer.getReader())
            self.metaChain.setWriter(self.metaWriter)


class Ssb(BaseDemodulatorChain):
    def __init__(self, agcProfile: AgcProfile = AgcProfile.FAST):
        agc = Agc(Format.FLOAT)
        agc.setProfile(agcProfile)
        workers = [
            RealPart(),
            agc,
        ]
        super().__init__(workers)


class Empty(BaseDemodulatorChain):
    def __init__(self):
        super().__init__([])

    def getOutputFormat(self) -> Format:
        return Format.FLOAT

    def setWriter(self, writer):
        pass


class SAm(BaseDemodulatorChain):
    def __init__(self, agcProfile: AgcProfile = AgcProfile.SLOW):
        self.updatePeriod = 10
        self.samplePeriod = 4
        agc = Agc(Format.FLOAT)
        agc.setProfile(agcProfile)
        agc.setInitialGain(200)
        workers = [
            Afc(self.updatePeriod, self.samplePeriod),
            RealPart(),
            DcBlock(),
            agc,
        ]
        super().__init__(workers)


class CquamStereoDecoder(ThreadModule):
    """Synchronously recover C-QUAM I/Q and emit interleaved L/R PCM."""

    def __init__(self, sampleRate: int):
        self.sampleRate = sampleRate
        zeta = 0.65
        omegaN = 200.0
        self.g1 = 1.0 - math.exp(-2.0 * omegaN * zeta / sampleRate)
        self.g2 = -self.g1 + 2.0 * (1.0 - math.exp(-omegaN * zeta / sampleRate) *
            math.cos(omegaN / sampleRate * math.sqrt(1.0 - zeta * zeta)))
        self.phaseError = 0.0
        self.filteredError = 0.0
        self.omega = 0.0
        self.omegaLimit = 2.0 * math.pi * 4000.0 / sampleRate
        self.dcLeft = 0.0
        self.dcRight = 0.0
        self.carrierLevel = 0.0
        self.carrierSmoothing = 1.0 - math.exp(-1.0 / sampleRate)
        super().__init__()

    def getInputFormat(self) -> Format:
        return Format.COMPLEX_FLOAT

    def getOutputFormat(self) -> Format:
        return Format.FLOAT

    def run(self):
        dcAlpha = 0.99
        while self.doRun:
            data = self.reader.read()
            if data is None:
                break
            source = memoryview(data).cast("f")
            output = array("f", [0.0]) * len(source)
            for index in range(0, len(source) - 1, 2):
                real = source[index]
                imag = source[index + 1]
                carrierMagnitude = math.hypot(real, imag)
                if self.carrierLevel <= 0.0:
                    self.carrierLevel = max(carrierMagnitude, 1e-4)
                else:
                    self.carrierLevel += self.carrierSmoothing * (carrierMagnitude - self.carrierLevel)
                phaseSin = math.sin(self.phaseError)
                phaseCos = math.cos(self.phaseError)
                inPhase = phaseCos * real + phaseSin * imag
                quadrature = -phaseSin * real + phaseCos * imag

                detector = math.atan2(quadrature, inPhase)
                previousError = self.filteredError
                self.omega = max(-self.omegaLimit, min(self.omegaLimit,
                    self.omega + self.g2 * detector))
                self.filteredError = self.g1 * detector + self.omega
                self.phaseError += previousError
                if self.phaseError > math.pi:
                    self.phaseError -= 2.0 * math.pi
                elif self.phaseError < -math.pi:
                    self.phaseError += 2.0 * math.pi

                left = inPhase + quadrature
                right = inPhase - quadrature
                nextLeft = left + dcAlpha * self.dcLeft
                nextRight = right + dcAlpha * self.dcRight
                left = nextLeft - self.dcLeft
                right = nextRight - self.dcRight
                # Use the slowly averaged RF carrier as one common gain reference.
                # Audio-derived gain pumping creates an audible wobble when L/R
                # contain different tones or programme material.
                gain = min(100.0, 0.35 / max(self.carrierLevel, 1e-4))
                output[index] = max(-0.9, min(0.9, left * gain))
                output[index + 1] = max(-0.9, min(0.9, right * gain))
                self.dcLeft = nextLeft
                self.dcRight = nextRight
            self.writer.write(output.tobytes())


class Cquam(BaseDemodulatorChain, FixedAudioRateChain, HdAudio):
    """Motorola C-QUAM AM stereo, following KiwiSDR's PLL I/Q matrix."""

    def __init__(self, sampleRate: int = 48000):
        self.sampleRate = sampleRate
        workers = [
            CquamStereoDecoder(sampleRate),
        ]
        super().__init__(workers)

    def getFixedAudioRate(self) -> int:
        return self.sampleRate


class SsbDigital(BaseDemodulatorChain, FixedAudioRateChain, HdAudio):
    def __init__(self, sampleRate: int = 48000):
        self.sampleRate = sampleRate
        workers = [
            RealPart(),
            Agc(Format.FLOAT),
        ]
        super().__init__(workers)

    def getFixedAudioRate(self) -> int:
        return self.sampleRate
