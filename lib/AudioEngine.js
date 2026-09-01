// this controls if the new AudioWorklet API should be used if available.
// the engine will still fall back to the ScriptProcessorNode if this is set to true but not available in the browser.
var useAudioWorklets = true;

function AudioEngine(maxBufferLength, audioReporter) {
    this.audioReporter = audioReporter;
    this.initStats();
    this.resetStats();

    this.onStartCallbacks = [];

    this.started = false;
    this.audioContext = this.buildAudioContext();
    if (!this.audioContext) {
        return;
    }

    var me = this;
    this.audioContext.onstatechange = function() {
        if (me.audioContext.state !== 'running') return;
        me._start();
    }

    this.audioCodec = new ImaAdpcmCodec();
    this.opusCodec = null;
    this.compression = 'none';

    this.setupResampling();
    this.resampler = new Interpolator(this.resamplingFactor);
    this.hdResampler = new Interpolator(this.hdResamplingFactor);
    this.hdStereoResampler = new StereoResampler(this.hdOutputRate, this.audioContext.sampleRate);

    this.maxBufferSize = maxBufferLength * this.getSampleRate();

    this.recorder = new AudioRecorder(this.getOutputRate(), 128, 1);
    this.hdRecorder = new AudioRecorder(48000, 192, 2);
    this.hdInputRate = this.getHdOutputRate();
    this.recording = false;
    this.lastHd = false;
    this.dabMono = false;
    this.drmAudioLocked = false;
    window.addEventListener('drm-audio-lock', function(event) {
        me.drmAudioLocked = !!(event.detail && event.detail.locked);
    });
    this.fmMono = false;
    this.fmStereoWidth = .65;
    // DAB headroom is applied to float PCM in the backend, before the
    // transport converts it to signed 16-bit samples.
    this.dabHeadroom = 1;
}

AudioEngine.prototype.buildAudioContext = function() {
    var ctxClass = window.AudioContext || window.webkitAudioContext;
    if (!ctxClass) {
        return;
    }

    // known good sample rates
    var goodRates = [48000, 44100, 96000]

    // let the browser chose the sample rate, if it is good, use it
    var ctx = new ctxClass({latencyHint: 'playback'});
    if (goodRates.indexOf(ctx.sampleRate) >= 0) {
        return ctx;
    }

    // if that didn't work, try if any of the good rates work
    if (goodRates.some(function(sr) {
        try {
            ctx = new ctxClass({sampleRate: sr, latencyHint: 'playback'});
            return true;
        } catch (e) {
            return false;
        }
    }, this)) {
        return ctx;
    }

    // fallback: let the browser decide
    // this may cause playback problems down the line
    return new ctxClass({latencyHint: 'playback'});
}

AudioEngine.prototype.resume = function(){
    this.audioContext.resume();
}

AudioEngine.prototype._start = function() {
    var me = this;

    // if failed to find a valid resampling factor...
    if (me.resamplingFactor === 0) {
         return;
    }

    // been started before?
    if (me.started) {
        return;
    }

    // are we allowed to play audio?
    if (!me.isAllowed()) {
        return;
    }
    me.started = true;

    var runCallbacks = function(workletType) {
        var callbacks = me.onStartCallbacks;
        me.onStartCallbacks = false;
        callbacks.forEach(function(c) { c(workletType); });
    };

    me.gainNode = me.audioContext.createGain();
    me.gainNode.connect(me.audioContext.destination);

    if (useAudioWorklets && me.audioContext.audioWorklet) {
        me.audioContext.audioWorklet.addModule('static/lib/AudioProcessor.js?v=fm-stereo-eq-1').then(function(){
            me.audioNode = new AudioWorkletNode(me.audioContext, 'openwebrx-audio-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: {
                    maxBufferSize: me.maxBufferSize
                }
            });
            me.audioNode.connect(me.gainNode);
            me.audioNode.port.addEventListener('message', function(m){
                var json = JSON.parse(m.data);
                if (typeof(json.buffersize) !== 'undefined') {
                    me.audioReporter({
                        buffersize: json.buffersize
                    });
                }
                if (typeof(json.samplesProcessed) !== 'undefined') {
                    me.audioSamples.add(json.samplesProcessed);
                }
            });
            me.audioNode.port.start();
            runCallbacks('AudioWorklet');
        });
    } else {
        me.audioBuffers = [];

        if (!AudioBuffer.prototype.copyToChannel) { //Chrome 36 does not have it, Firefox does
            AudioBuffer.prototype.copyToChannel = function (input, channel) //input is Float32Array
            {
                var cd = this.getChannelData(channel);
                for (var i = 0; i < input.length; i++) cd[i] = input[i];
            }
        }

        var bufferSize;
        if (me.audioContext.sampleRate < 44100 * 2)
            bufferSize = 4096;
        else if (me.audioContext.sampleRate >= 44100 * 2 && me.audioContext.sampleRate < 44100 * 4)
            bufferSize = 4096 * 2;
        else if (me.audioContext.sampleRate > 44100 * 4)
            bufferSize = 4096 * 4;


        function audio_onprocess(e) {
            var total = 0;
            var left = e.outputBuffer.getChannelData(0);
            var right = e.outputBuffer.getChannelData(1);
            while (me.audioBuffers.length && total < bufferSize) {
                var b = me.audioBuffers[0];
                var needed = b.stereo ? 2 : 1;
                if (b.pos + needed > b.data.length) { me.audioBuffers.shift(); continue; }
                left[total] = b.data[b.pos++];
                right[total] = b.stereo ? b.data[b.pos++] : left[total];
                if ((b.dab && me.dabMono) || (b.fm && me.fmMono)) {
                    var monoSample = (left[total] + right[total]) * .5;
                    left[total] = monoSample;
                    right[total] = monoSample;
                }
                if (b.fm && !me.fmMono) {
                    var mid = (left[total] + right[total]) * .5;
                    var side = (left[total] - right[total]) * .5 * me.fmStereoWidth;
                    left[total] = mid + side;
                    right[total] = mid - side;
                }
                if (b.dab) {
                    left[total] *= me.dabHeadroom;
                    right[total] *= me.dabHeadroom;
                }
                total++;
            }
            me.audioSamples.add(total);

        }

        //on Chrome v36, createJavaScriptNode has been replaced by createScriptProcessor
        var method = 'createScriptProcessor';
        if (me.audioContext.createJavaScriptNode) {
            method = 'createJavaScriptNode';
        }
        me.audioNode = me.audioContext[method](bufferSize, 0, 2);
        me.audioNode.onaudioprocess = audio_onprocess;
        me.audioNode.connect(me.gainNode);
        runCallbacks('ScriptProcessorNode')
    }

    setInterval(me.reportStats.bind(me), 1000);
};

AudioEngine.prototype.onStart = function(callback) {
    if (this.onStartCallbacks) {
        this.onStartCallbacks.push(callback);
    } else {
        callback();
    }
};

AudioEngine.prototype.isAllowed = function() {
    return this.audioContext.state === 'running';
};

AudioEngine.prototype.isStarted = function() {
    return this.started;
};

AudioEngine.prototype.reportStats = function() {
    if (this.audioNode.port) {
        this.audioNode.port.postMessage(JSON.stringify({cmd:'getStats'}));
    } else {
        this.audioReporter({
            buffersize: this.getBuffersize()
        });
    }
};

AudioEngine.prototype.initStats = function() {
    var me = this;
    var buildReporter = function(key) {
        return function(v){
            var report = {};
            report[key] = v;
            me.audioReporter(report);
        }

    };

    this.audioBytes = new Measurement();
    this.audioBytes.report(10000, 1000, buildReporter('audioByteRate'));

    this.audioSamples = new Measurement();
    this.audioSamples.report(10000, 1000, buildReporter('audioRate'));
};

AudioEngine.prototype.resetStats = function() {
    this.audioBytes.reset();
    this.audioSamples.reset();
};

AudioEngine.prototype.setupResampling = function() { //both at the server and the client
    var targetRate = this.audioContext.sampleRate;
    // Wide analog modes need enough Nyquist headroom for a true 15 kHz
    // passband. Prefer the native browser rate (normally 44.1/48 kHz).
    var audio_params = this.findRate(32000, 48000);
    if (!audio_params) {
        this.resamplingFactor = 0;
        this.outputRate = 0;
        divlog('Your audio card sampling rate (' + targetRate + ') is not supported.<br />Please change your operating system default settings in order to fix this.', 1);
    } else {
        this.resamplingFactor = audio_params.resamplingFactor;
        this.outputRate = audio_params.outputRate;
    }

    var hd_audio_params = this.findRate(36000, 48000);
    if (!hd_audio_params) {
        this.hdResamplingFactor = 0;
        this.hdOutputRate = 0;
        divlog('Your audio card sampling rate (' + targetRate + ') is not supported for HD audio<br />Please change your operating system default settings in order to fix this.', 1);
    } else {
        this.hdResamplingFactor = hd_audio_params.resamplingFactor;
        this.hdOutputRate = hd_audio_params.outputRate;
    }
};

AudioEngine.prototype.findRate = function(low, high) {
    var targetRate = this.audioContext.sampleRate;
    var i = 1;
    while (true) {
        var audio_server_output_rate = Math.floor(targetRate / i);
        if (audio_server_output_rate < low) {
            return;
        } else if (audio_server_output_rate >= low && audio_server_output_rate <= high) {
            return {
                resamplingFactor: i,
                outputRate: audio_server_output_rate
            }
        }
        i++;
    };
}

AudioEngine.prototype.getOutputRate = function() {
    return this.outputRate;
};

AudioEngine.prototype.getHdOutputRate = function() {
    return this.hdOutputRate;
}

AudioEngine.prototype.getSampleRate = function() {
    return this.audioContext.sampleRate;
};

AudioEngine.prototype.processAudio = function(data, resampler, recorder, stereo, dab, neutralStereo) {
    if (!this.audioNode) return;
    this.audioBytes.add(data.byteLength);
    var buffer;
    if (this.compression === "adpcm") {
        //resampling & ADPCM
        buffer = this.audioCodec.decodeWithSync(new Uint8Array(data));
    } else if (this.compression === "opus") {
        if (!this.opusCodec) this.opusCodec = new OpusStreamDecoder();
        var me = this;
        this.opusCodec.push(new Uint8Array(data), function(decoded, channels) {
            me.processDecodedAudio(decoded, resampler, recorder, channels === 2, dab, neutralStereo);
        });
        return;
    } else {
        buffer = new Int16Array(data);
    }
    this.processDecodedAudio(buffer, resampler, recorder, stereo, dab, neutralStereo);
}

AudioEngine.prototype.processDecodedAudio = function(buffer, resampler, recorder, stereo, dab, neutralStereo) {
    if (typeof UI !== 'undefined' && UI.getModulation && UI.getModulation() === 'drm' && !this.drmAudioLocked) {
        buffer = new Int16Array(buffer.length);
    }
    if(this.recording) {
        recorder.record(buffer, stereo);
    }
    if (stereo) {
        var leftPeak = 0, rightPeak = 0, monoPeak = 0;
        var differencePeak = 0;
        for (var i = 0; i + 1 < buffer.length; i += 2) {
            leftPeak = Math.max(leftPeak, Math.abs(buffer[i]));
            rightPeak = Math.max(rightPeak, Math.abs(buffer[i + 1]));
            monoPeak = Math.max(monoPeak, Math.abs((buffer[i] + buffer[i + 1]) * .5));
            differencePeak = Math.max(differencePeak, Math.abs((buffer[i] - buffer[i + 1]) * .5));
        }
        if (dab) {
            var meterLeft = this.dabMono? monoPeak : leftPeak;
            var meterRight = this.dabMono? monoPeak : rightPeak;
            window.dispatchEvent(new CustomEvent('dab-audio-level', {detail: {
                left: meterLeft / 32768 * this.dabHeadroom,
                right: meterRight / 32768 * this.dabHeadroom
            }}));
        } else {
            window.dispatchEvent(new CustomEvent('fm-audio-level', {detail: {
                level: Math.max(leftPeak, rightPeak) / 32768,
                left: leftPeak / 32768,
                right: rightPeak / 32768,
                difference: differencePeak / 32768,
                stereo: differencePeak > Math.max(160, monoPeak * .015)
            }}));
        }
    } else if (typeof UI !== 'undefined' && UI.getModulation && UI.getModulation() === 'wfm') {
        var fmPeak = 0;
        for (var j = 0; j < buffer.length; j++) fmPeak = Math.max(fmPeak, Math.abs(buffer[j]));
        window.dispatchEvent(new CustomEvent('fm-audio-level', {detail: {level: fmPeak / 32768}}));
    }
    buffer = resampler.process(buffer);
    if (this.audioNode.port) {
        // AudioWorklets supported
        this.audioNode.port.postMessage({samples: buffer, stereo: !!stereo, dab: !!dab, fm: !!stereo && !dab && !neutralStereo,
            forceMono: (dab && this.dabMono) || (stereo && !dab && !neutralStereo && this.fmMono)});
    } else {
        // silently drop excess samples
        if (this.getBuffersize() + buffer.length <= this.maxBufferSize) {
            this.audioBuffers.push({data: buffer, stereo: !!stereo, dab: !!dab, fm: !!stereo && !dab && !neutralStereo, pos: 0});
        }
    }
}

AudioEngine.prototype.buildFmAudioBands = function(buffer) {
    var frequencies = [60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 15000];
    var bands = new Array(frequencies.length).fill(0);
    var frames = Math.min(256, Math.floor(buffer.length / 2));
    if (frames < 32) return bands;
    var rate = this.getHdOutputRate() || 48000;
    var mono = new Float32Array(frames);
    var start = Math.max(0, Math.floor(buffer.length / 2) - frames);
    for (var n = 0; n < frames; n++) {
        var p = (start + n) * 2;
        var windowValue = .5 - .5 * Math.cos(2 * Math.PI * n / (frames - 1));
        mono[n] = (buffer[p] + buffer[p + 1]) / 65536 * windowValue;
    }
    frequencies.forEach(function(frequency, band) {
        var real = 0, imag = 0;
        var omega = 2 * Math.PI * frequency / rate;
        for (var i = 0; i < frames; i++) {
            var c = Math.cos(omega * i), s = Math.sin(omega * i);
            real += mono[i] * c; imag -= mono[i] * s;
        }
        var amplitude = Math.sqrt(real * real + imag * imag) / frames;
        bands[band] = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(amplitude, .0001)) + 65) / 65));
    });
    return bands;
};

AudioEngine.prototype.pushAudio = function(data) {
    this.processAudio(data, this.resampler, this.recorder, false, false);
    this.lastHd = false;
};

AudioEngine.prototype.pushHdAudio = function(data) {
    var modulation = typeof UI !== 'undefined' && UI.getModulation ? UI.getModulation() : '';
    var stereo = modulation === 'dab' || modulation === 'drm' || modulation === 'wfm' || modulation === 'cquam';
    var neutralStereo = modulation === 'cquam';
    this.hdRecorder.setInputRate(modulation === 'dab' ? this.hdInputRate : this.getHdOutputRate());
    this.processAudio(data, stereo ? this.hdStereoResampler : this.hdResampler, this.hdRecorder, stereo, modulation === 'dab', neutralStereo);
    this.lastHd = true;
}

AudioEngine.prototype.setDabMono = function(mono) {
    this.dabMono = !!mono;
    if (this.audioNode && this.audioNode.port) {
        this.audioNode.port.postMessage({cmd: 'setDabMono', mono: this.dabMono});
    }
};

AudioEngine.prototype.setFmMono = function(mono) {
    this.fmMono = !!mono;
    if (this.audioNode && this.audioNode.port) {
        this.audioNode.port.postMessage({cmd: 'setFmMono', mono: this.fmMono});
    }
};

AudioEngine.prototype.setFmStereoWidth = function(width) {
    this.fmStereoWidth = Math.max(0, Math.min(1, Number(width) || 0));
    if (this.audioNode && this.audioNode.port) {
        this.audioNode.port.postMessage({cmd: 'setFmStereoWidth', width: this.fmStereoWidth});
    }
};

AudioEngine.prototype.setCompression = function(compression) {
    if (compression !== this.compression && this.opusCodec) {
        this.opusCodec.close();
        this.opusCodec = null;
    }
    this.compression = compression;
};

function OpusStreamDecoder() {
    this.pending = new Uint8Array(0);
    this.decoder = null;
    this.channels = 0;
    this.timestamp = 0;
    this.callback = null;
}

OpusStreamDecoder.prototype.configure = function(channels, sampleRate, callback) {
    this.callback = callback;
    if (this.decoder && this.channels === channels && this.sampleRate === sampleRate) return true;
    this.close(false);
    if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') return false;
    var me = this;
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.decoder = new AudioDecoder({
        output: function(audio) {
            try {
                var pcm = new Int16Array(audio.numberOfFrames * audio.numberOfChannels);
                audio.copyTo(pcm, {planeIndex: 0, format: 's16'});
                if (me.callback) me.callback(pcm, audio.numberOfChannels);
            } finally { audio.close(); }
        },
        error: function(error) { console.warn('Opus decoder:', error); }
    });
    this.decoder.configure({codec: 'opus', sampleRate: sampleRate, numberOfChannels: channels});
    return true;
};

OpusStreamDecoder.prototype.push = function(data, callback) {
    var joined = new Uint8Array(this.pending.length + data.length);
    joined.set(this.pending);joined.set(data, this.pending.length);
    var offset = 0;
    while (joined.length - offset >= 7) {
        if (joined[offset] !== 79 || joined[offset + 1] !== 80) { offset++; continue; }
        var channels = joined[offset + 2], sampleRate = joined[offset + 3] | (joined[offset + 4] << 8), size = joined[offset + 5] | (joined[offset + 6] << 8);
        if (channels < 1 || channels > 2 || [8000,12000,16000,24000,48000].indexOf(sampleRate)<0 || size < 1 || size > 4000) { offset++; continue; }
        if (joined.length - offset < size + 7) break;
        if (!this.configure(channels, sampleRate, callback)) return;
        this.decoder.decode(new EncodedAudioChunk({
            type: 'key', timestamp: this.timestamp, duration: 20000,
            data: joined.slice(offset + 7, offset + 7 + size)
        }));
        this.timestamp += 20000;offset += size + 7;
    }
    this.pending = joined.slice(offset);
};

OpusStreamDecoder.prototype.close = function(resetPending) {
    if (this.decoder) { try { this.decoder.close(); } catch (e) {} }
    this.decoder = null;this.channels = 0;this.sampleRate = 0;this.timestamp = 0;
    if (resetPending !== false) this.pending = new Uint8Array(0);
};

AudioEngine.prototype.setHdInputRate = function(rate) {
    if (rate === 32000 || rate === 48000) {
        this.hdInputRate = rate;
        this.hdStereoResampler.setInputRate(rate);
    }
};

AudioEngine.prototype.setVolume = function(volume) {
    this.gainNode.gain.value = volume;
};

AudioEngine.prototype.getBuffersize = function() {
    // only available when using ScriptProcessorNode
    if (!this.audioBuffers) return 0;
    return this.audioBuffers.map(function(b){ return (b.data.length - b.pos) / (b.stereo ? 2 : 1); }).reduce(function(a, b){ return a + b; }, 0);
};

AudioEngine.prototype.startRecording = function() {
    if (!this.recording) {
        var date = new Date(Date.now()).toISOString().slice(2,19)
            .replaceAll('-','').replaceAll(':','').replaceAll('T','-');
        var freq = Math.round(UI.getFrequency() / 1000);
        this.mp3fileName = "REC-" + date + '-' + freq + ".mp3";
        this.recording = true;
    }
};

AudioEngine.prototype.stopRecording = function() {
    if (this.recording) {
        this.recording = false;

        // Save last updated recording
        if (this.lastHd) {
            this.hdRecorder.saveRecording(this.mp3fileName);
        } else {
            this.recorder.saveRecording(this.mp3fileName);
        }

        // Clear and stop all recorders
        this.hdRecorder.stopRecording();
        this.recorder.stopRecording();
    }
};

function AudioRecorder(sampleRate, kbps, channels) {
    this.channels = channels || 1;
    this.sampleRate = sampleRate;
    this.inputSampleRate = sampleRate;
    this.mp3encoder = new lamejs.Mp3Encoder(this.channels, sampleRate, kbps);
    this.blockSize  = 1152; // better be a multiple of 576
    this.mp3Data    = [];
}

AudioRecorder.prototype.setInputRate = function(sampleRate) {
    if (sampleRate > 0) this.inputSampleRate = sampleRate;
};

AudioRecorder.prototype.resample = function(samples, stereo) {
    if (this.inputSampleRate === this.sampleRate) return samples;
    var sourceChannels = stereo ? 2 : 1;
    var sourceFrames = Math.floor(samples.length / sourceChannels);
    var targetFrames = Math.max(1, Math.round(sourceFrames * this.sampleRate / this.inputSampleRate));
    var output = new Int16Array(targetFrames * sourceChannels);
    for (var frame = 0; frame < targetFrames; frame++) {
        var position = frame * this.inputSampleRate / this.sampleRate;
        var before = Math.min(sourceFrames - 1, Math.floor(position));
        var after = Math.min(sourceFrames - 1, before + 1);
        var mix = position - before;
        for (var channel = 0; channel < sourceChannels; channel++) {
            var a = samples[before * sourceChannels + channel];
            var b = samples[after * sourceChannels + channel];
            output[frame * sourceChannels + channel] = a + (b - a) * mix;
        }
    }
    return output;
};

AudioRecorder.prototype.record = function(samples, stereo) {
    samples = this.resample(samples, stereo);
    var left, right;
    if (this.channels === 2) {
        var frames = stereo ? Math.floor(samples.length / 2) : samples.length;
        left = new Int16Array(frames);
        right = new Int16Array(frames);
        for (var j = 0; j < frames; j++) {
            left[j] = samples[stereo ? j * 2 : j];
            right[j] = samples[stereo ? j * 2 + 1 : j];
        }
    }
    var length = this.channels === 2 ? left.length : samples.length;
    for (var i = 0; i < length; i += this.blockSize) {
        var mp3buf = this.channels === 2
            ? this.mp3encoder.encodeBuffer(left.subarray(i, i + this.blockSize), right.subarray(i, i + this.blockSize))
            : this.mp3encoder.encodeBuffer(samples.subarray(i, i + this.blockSize));
        if (mp3buf.length > 0) this.mp3Data.push(mp3buf);
    }
};

AudioRecorder.prototype.stopRecording = function() {
    this.mp3encoder.flush();
    this.mp3Data = [];
}

AudioRecorder.prototype.saveRecording = function(name) {
    // finish writing mp3
    var mp3buf = this.mp3encoder.flush();
    if (mp3buf.length>0) this.mp3Data.push(new Int8Array(mp3buf));

    // Do not save unless we have data
    if (this.mp3Data.length==0) return false;

    var blob = new Blob(this.mp3Data, {type: "audio/mp3"});

    var a = document.createElement("a");
    a.href = window.URL.createObjectURL(blob);
    a.style = "display: none";
    a.download = name;
    document.body.appendChild(a);
    a.click();

    setTimeout(function() {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(a.href);
    }, 0);

    // Success
    return true;
};

function ImaAdpcmCodec() {
    this.reset();
}

ImaAdpcmCodec.prototype.reset = function() {
    this.stepIndex = 0;
    this.predictor = 0;
    this.step = 0;
    this.synchronized = 0;
    this.syncWord = "SYNC";
    this.syncCounter = 0;
    this.phase = 0;
    this.syncBuffer = new Uint8Array(4);
    this.syncBufferIndex = 0;
};

ImaAdpcmCodec.imaIndexTable = [ -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8 ];

ImaAdpcmCodec.imaStepTable = [
                               7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
                               19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
                               50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
                               130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
                               337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
                               876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
                               2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
                               5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
                               15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
                             ];

ImaAdpcmCodec.prototype.decode = function(data) {
    var output = new Int16Array(data.length * 2);
    for (var i = 0; i < data.length; i++) {
        output[i * 2] = this.decodeNibble(data[i] & 0x0F);
        output[i * 2 + 1] = this.decodeNibble((data[i] >> 4) & 0x0F);
    }
    return output;
};

ImaAdpcmCodec.prototype.decodeWithSync = function(data) {
    var output = new Int16Array(data.length * 2);
    var oi = 0;
    for (var index = 0; index < data.length; index++) {
        switch (this.phase) {
            case 0:
                // search for sync word
                if (data[index] !== this.syncWord.charCodeAt(this.synchronized++)) {
                    // reset if data is unexpected
                    this.synchronized = 0;
                }
                // if sync word has been found pass on to next phase
                if (this.synchronized === 4) {
                    this.syncBufferIndex = 0;
                    this.phase = 1;
                }
                break;
            case 1:
                // read codec runtime data from stream
                this.syncBuffer[this.syncBufferIndex++] = data[index];
                // if data is complete, apply and pass on to next phase
                if (this.syncBufferIndex === 4) {
                    var syncData = new Int16Array(this.syncBuffer.buffer);
                    this.stepIndex = syncData[0];
                    this.predictor = syncData[1];
                    this.syncCounter = 1000;
                    this.phase = 2;
                }
                break;
            case 2:
                // decode actual audio data
                output[oi++] = this.decodeNibble(data[index] & 0x0F);
                output[oi++] = this.decodeNibble(data[index] >> 4);
                // if the next sync keyword is due, reset and return to phase 0
                if (this.syncCounter-- === 0) {
                    this.synchronized = 0;
                    this.phase = 0;
                }
                break;
        }
    }
    return output.slice(0, oi);
};

ImaAdpcmCodec.prototype.decodeNibble = function(nibble) {
    this.stepIndex += ImaAdpcmCodec.imaIndexTable[nibble];
    this.stepIndex = Math.min(Math.max(this.stepIndex, 0), 88);

    var diff = this.step >> 3;
    if (nibble & 1) diff += this.step >> 2;
    if (nibble & 2) diff += this.step >> 1;
    if (nibble & 4) diff += this.step;
    if (nibble & 8) diff = -diff;

    this.predictor += diff;
    this.predictor = Math.min(Math.max(this.predictor, -32768), 32767);

    this.step = ImaAdpcmCodec.imaStepTable[this.stepIndex];

    return this.predictor;
};

function Interpolator(factor) {
    this.factor = factor;
    this.lowpass = new Lowpass(factor)
}

function StereoResampler(inputRate, outputRate) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.reset();
}

StereoResampler.prototype.setInputRate = function(inputRate) {
    if (this.inputRate === inputRate) return;
    this.inputRate = inputRate;
    this.reset();
};

StereoResampler.prototype.reset = function() {
    this.previousLeft = 0;
    this.previousRight = 0;
    this.hasPrevious = false;
    this.nextPosition = 0;

    // A fourth-order Butterworth low-pass removes the spectral image created
    // when 32 kHz DAB audio is converted to the browser's 48 kHz rate.
    this.lowpass = [];
    if (this.inputRate < this.outputRate) {
        var cutoff = Math.min(this.inputRate * 0.45, this.outputRate * 0.45);
        this.lowpass.push(new StereoBiquadLowpass(cutoff, this.outputRate, 0.5411961));
        this.lowpass.push(new StereoBiquadLowpass(cutoff, this.outputRate, 1.3065630));
    }
};

StereoResampler.prototype.process = function(data) {
    var frames = Math.floor(data.length / 2);
    if (!frames) return new Float32Array(0);

    if (this.inputRate === this.outputRate) {
        var direct = new Float32Array(frames * 2);
        for (var d = 0; d < direct.length; d++) direct[d] = (data[d] + .5) / 32768;
        return direct;
    }

    var ratio = this.outputRate / this.inputRate;
    var step = 1 / ratio;
    var virtualFrames = frames + (this.hasPrevious ? 1 : 0);
    var position = this.hasPrevious ? this.nextPosition : 0;
    var output = new Float32Array(Math.ceil(virtualFrames * ratio) * 2);
    var oi = 0;

    while (position < virtualFrames - 1) {
        var a = Math.floor(position);
        var b = a + 1;
        var mix = position - a;
        var leftA = this.hasPrevious && a === 0 ? this.previousLeft : data[(a - (this.hasPrevious ? 1 : 0)) * 2];
        var rightA = this.hasPrevious && a === 0 ? this.previousRight : data[(a - (this.hasPrevious ? 1 : 0)) * 2 + 1];
        var leftB = data[(b - (this.hasPrevious ? 1 : 0)) * 2];
        var rightB = data[(b - (this.hasPrevious ? 1 : 0)) * 2 + 1];
        output[oi++] = ((leftA * (1 - mix) + leftB * mix) + .5) / 32768;
        output[oi++] = ((rightA * (1 - mix) + rightB * mix) + .5) / 32768;
        position += step;
    }

    this.previousLeft = data[(frames - 1) * 2];
    this.previousRight = data[(frames - 1) * 2 + 1];
    this.hasPrevious = true;
    this.nextPosition = position - (virtualFrames - 1);

    output = output.slice(0, oi);
    for (var f = 0; f < this.lowpass.length; f++) output = this.lowpass[f].process(output);
    return output;
};

function StereoBiquadLowpass(cutoff, sampleRate, q) {
    var omega = 2 * Math.PI * cutoff / sampleRate;
    var cos = Math.cos(omega);
    var alpha = Math.sin(omega) / (2 * q);
    var a0 = 1 + alpha;
    this.b0 = ((1 - cos) / 2) / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = [0, 0];
    this.x2 = [0, 0];
    this.y1 = [0, 0];
    this.y2 = [0, 0];
}

StereoBiquadLowpass.prototype.process = function(data) {
    var output = new Float32Array(data.length);
    for (var i = 0; i < data.length; i++) {
        var channel = i & 1;
        var value = this.b0 * data[i] + this.b1 * this.x1[channel] + this.b2 * this.x2[channel]
            - this.a1 * this.y1[channel] - this.a2 * this.y2[channel];
        this.x2[channel] = this.x1[channel];
        this.x1[channel] = data[i];
        this.y2[channel] = this.y1[channel];
        this.y1[channel] = value;
        output[i] = value;
    }
    return output;
};

Interpolator.prototype.process = function(data) {
    var output = new Float32Array(data.length * this.factor);
    for (var i = 0; i < data.length; i++) {
        output[i * this.factor] = (data[i] + 0.5) / 32768;
    }
    return this.lowpass.process(output);
};

function Lowpass(interpolation) {
    this.interpolation = interpolation;
    var transitionBandwidth = 0.05;
    this.numtaps = Math.round(4 / transitionBandwidth);
    if (this.numtaps % 2 == 0) this.numtaps += 1;

    var cutoff = 1 / interpolation;
    this.coefficients = this.getCoefficients(cutoff / 2);

    this.delay = new Float32Array(this.numtaps);
    for (var i = 0; i < this.numtaps; i++){
        this.delay[i] = 0;
    }
    this.delayIndex = 0;
}

Lowpass.prototype.getCoefficients = function(cutoffRate) {
    var middle = Math.floor(this.numtaps / 2);
    // hamming window
    var window_function = function(r){
        var rate = 0.5 + r / 2;
        return 0.54 - 0.46 * Math.cos(2 * Math.PI * rate);
    }
    var output = [];
    output[middle] = 2 * Math.PI * cutoffRate * window_function(0);
    for (var i = 1; i <= middle; i++) {
        output[middle - i] = output[middle + i] = (Math.sin(2 * Math.PI * cutoffRate * i) / i) * window_function(i / middle);
    }
    return this.normalizeCoefficients(output);
};

Lowpass.prototype.normalizeCoefficients = function(input) {
    var sum = 0;
    var output = [];
    for (var i = 0; i < input.length; i++) {
        sum += input[i];
    }
    for (var i = 0; i < input.length; i++) {
        output[i] = input[i] / sum;
    }
    return output;
};

Lowpass.prototype.process = function(input) {
    output = new Float32Array(input.length);
    for (var oi = 0; oi < input.length; oi++) {
        this.delay[this.delayIndex] = input[oi];
        this.delayIndex = (this.delayIndex + 1) % this.numtaps;

        var acc = 0;
        var index = this.delayIndex;
        for (var i = 0; i < this.numtaps; ++i) {
            var index = index != 0 ? index - 1 : this.numtaps - 1;
            acc += this.delay[index] * this.coefficients[i];
            if (isNaN(acc)) debugger;
        }
        // gain by interpolation
        output[oi] = this.interpolation * acc;
    }
    return output;
};
