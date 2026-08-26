class OwrxAudioProcessor extends AudioWorkletProcessor {
    constructor(options){
        super(options);
        // initialize ringbuffer, make sure it aligns with the expected buffer size of 128
        this.bufferSize = Math.round(options.processorOptions.maxBufferSize / 128) * 128;
        this.leftBuffer = new Float32Array(this.bufferSize);
        this.rightBuffer = new Float32Array(this.bufferSize);
        this.inPos = 0;
        this.outPos = 0;
        this.samplesProcessed = 0;
        this.stereoMode = false;
        this.dabMode = false;
        this.fmMono = false;
        this.fmStereoWidth = .65;
        this.forceMono = false;
        // DAB headroom is applied before integer transport conversion.
        this.dabHeadroom = 1;
        this.playing = true;
        this.fadeGain = 1;
        this.lastLeft = 0;
        this.lastRight = 0;
        this.prebufferFrames = 2048;
        this.port.addEventListener('message', (m) => {
            if (typeof(m.data) === 'string') {
                const json = JSON.parse(m.data);
                if (json.cmd && json.cmd === 'getStats') {
                    this.reportStats();
                }
            } else {
                if (m.data && m.data.cmd === 'setDabMono') {
                    this.forceMono = !!m.data.mono;
                    return;
                }
                if (m.data && m.data.cmd === 'setFmMono') {
                    this.fmMono = !!m.data.mono;
                    return;
                }
                if (m.data && m.data.cmd === 'setFmStereoWidth') {
                    this.fmStereoWidth = Math.max(0, Math.min(1, Number(m.data.width) || 0));
                    return;
                }
                const stereo = !!m.data.stereo;
                this.dabMode = !!m.data.dab;
                this.forceMono = !!m.data.forceMono || (!!m.data.fm && this.fmMono);
                this.stereoMode = stereo;
                if (!stereo) this.playing = true;
                const samples = m.data.samples || m.data;
                const frames = stereo ? Math.floor(samples.length / 2) : samples.length;
                for (let i = 0; i < frames; i++) {
                    const p = (this.inPos + i) % this.bufferSize;
                    this.leftBuffer[p] = samples[stereo ? i * 2 : i];
                    this.rightBuffer[p] = samples[stereo ? i * 2 + 1 : i];
                }
                this.inPos = (this.inPos + frames) % this.bufferSize;
            }
        });
        this.port.addEventListener('messageerror', console.error);
        this.port.start();
    }
    process(inputs, outputs) {
        if (this.stereoMode && !this.playing && this.remaining() < this.prebufferFrames) {
            outputs[0].forEach(output => output.fill(0));
            return true;
        }
        if (this.stereoMode && !this.playing) this.playing = true;
        if (this.remaining() < 128) {
            const output = outputs[0];
            for (let i = 0; i < 128; i++) {
                const gain = 1 - i / 127;
                output[0][i] = this.lastLeft * gain;
                output[1][i] = this.lastRight * gain;
            }
            this.lastLeft = 0;
            this.lastRight = 0;
            this.playing = !this.stereoMode;
            this.fadeGain = 0;
            return true;
        }
        const output = outputs[0];
        for (let i = 0; i < 128; i++) {
            const p = (this.outPos + i) % this.bufferSize;
            this.fadeGain = Math.min(1, this.fadeGain + 1 / 256);
            const outputGain = this.fadeGain * (this.dabMode ? this.dabHeadroom : 1);
            let left = this.leftBuffer[p] * outputGain;
            let right = this.rightBuffer[p] * outputGain;
            const mono = (left + right) * .5;
            if (this.stereoMode && !this.dabMode && !this.forceMono) {
                const side = (left - right) * .5 * this.fmStereoWidth;
                left = mono + side;
                right = mono - side;
            }
            output[0][i] = this.forceMono ? mono : left;
            output[1][i] = this.forceMono ? mono : right;
            this.lastLeft = output[0][i];
            this.lastRight = output[1][i];
        }
        this.outPos = (this.outPos + 128) % this.bufferSize;
        this.samplesProcessed += 128;
        return true;
    }
    remaining() {
        const mod = (this.inPos - this.outPos) % this.bufferSize;
        if (mod >= 0) return mod;
        return mod + this.bufferSize;
    }
    reportStats() {
        this.port.postMessage(JSON.stringify({
            buffersize: this.remaining(),
            samplesProcessed: this.samplesProcessed
        }));
        this.samplesProcessed = 0;
    }
}

registerProcessor('openwebrx-audio-processor', OwrxAudioProcessor);
