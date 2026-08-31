from csdr.chain import Chain
from pycsdr.modules import AudioResampler, Convert, AdpcmEncoder, Limit, NoiseFilter, ExecModule
from pycsdr.types import Format


class OpusEncoder(ExecModule):
    def __init__(self, channels: int, sampleRate: int):
        super().__init__(Format.SHORT, Format.CHAR, ["/usr/local/lib/openwebrx/opus-encode-96k", str(channels), str(sampleRate)])


class Converter(Chain):
    def __init__(self, format: Format, inputRate: int, clientRate: int, nrEnabled: bool, nrThreshold: int):
        workers = []
        # we only have an audio resampler and noise filter for float ATM,
        # so if we need to resample or remove noise, we need to convert
        if (inputRate != clientRate or nrEnabled) and format != Format.FLOAT:
            workers += [Convert(format, Format.FLOAT)]
        if nrEnabled:
            workers += [NoiseFilter(nrThreshold)]
        if inputRate != clientRate:
            workers += [AudioResampler(inputRate, clientRate), Limit(), Convert(Format.FLOAT, Format.SHORT)]
        elif format != Format.SHORT:
            workers += [Convert(format, Format.SHORT)]
        super().__init__(workers)


class ClientAudioChain(Chain):
    def __init__(self, format: Format, inputRate: int, clientRate: int, compression: str, nrEnabled: bool, nrThreshold: int, channels: int = 1):
        self.format = format
        self.inputRate = inputRate
        self.clientRate = clientRate
        self.nrEnabled = nrEnabled
        self.nrThreshold = nrThreshold
        self.compression = compression
        self.channels = channels
        workers = []
        converter = self._buildConverter()
        if not converter.empty():
            workers += [converter]
        if compression == "adpcm":
            workers += [AdpcmEncoder(sync=True)]
        elif compression == "opus":
            workers += [OpusEncoder(channels, clientRate)]
        super().__init__(workers)

    def _buildConverter(self):
        return Converter(self.format, self.inputRate, self.clientRate, self.nrEnabled, self.nrThreshold)

    def _updateConverter(self):
        converter = self._buildConverter()
        index = self.indexOf(lambda x: isinstance(x, Converter))
        if converter.empty():
            if index >= 0:
                self.remove(index)
        else:
            if index >= 0:
                self.replace(index, converter)
            else:
                self.insert(0, converter)

    def setFormat(self, format: Format) -> None:
        if format == self.format:
            return
        self.format = format
        self._updateConverter()

    def setInputRate(self, inputRate: int) -> None:
        if inputRate == self.inputRate:
            return
        self.inputRate = inputRate
        self._updateConverter()

    def setClientRate(self, clientRate: int) -> None:
        if clientRate == self.clientRate:
            return
        self.clientRate = clientRate
        self._updateConverter()
        if self.compression == "opus":
            index = self.indexOf(lambda x: isinstance(x, OpusEncoder))
            if index >= 0:
                self.replace(index, OpusEncoder(self.channels, clientRate))

    def setAudioCompression(self, compression: str) -> None:
        index = self.indexOf(lambda x: isinstance(x, (AdpcmEncoder, OpusEncoder)))
        self.compression = compression
        if index >= 0:
            self.remove(index)
        if compression == "adpcm":
            self.append(AdpcmEncoder(sync=True))
        elif compression == "opus":
            self.append(OpusEncoder(self.channels, self.clientRate))

    def setChannels(self, channels: int) -> None:
        if channels == self.channels:
            return
        self.channels = channels
        if self.compression == "opus":
            index = self.indexOf(lambda x: isinstance(x, OpusEncoder))
            if index >= 0:
                self.replace(index, OpusEncoder(channels, self.clientRate))

    def setNrEnabled(self, nrEnabled: bool) -> None:
        if nrEnabled == self.nrEnabled:
            return
        self.nrEnabled = nrEnabled
        self._updateConverter()

    def setNrThreshold(self, nrThreshold: int) -> None:
        if nrThreshold == self.nrThreshold:
            return
        self.nrThreshold = nrThreshold
        self._updateConverter()
