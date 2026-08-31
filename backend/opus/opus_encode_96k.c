#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <opus/opus.h>

#define BITRATE 96000
#define MAX_PACKET 4000

static int read_frame(int16_t *pcm, size_t bytes) {
    size_t used = 0;
    while (used < bytes) {
        size_t n = fread((uint8_t *)pcm + used, 1, bytes - used, stdin);
        if (!n) {
            if (feof(stdin)) return used == 0 ? 0 : -1;
            if (ferror(stdin) && errno == EINTR) { clearerr(stdin); continue; }
            return -1;
        }
        used += n;
    }
    return 1;
}

int main(int argc, char **argv) {
    int channels = argc > 1 ? atoi(argv[1]) : 2;
    int sample_rate = argc > 2 ? atoi(argv[2]) : 48000;
    if (channels != 1 && channels != 2) return 2;
    if (sample_rate != 8000 && sample_rate != 12000 && sample_rate != 16000 && sample_rate != 24000 && sample_rate != 48000) return 2;
    int frame_samples = sample_rate / 50;
    int error = OPUS_OK;
    OpusEncoder *encoder = opus_encoder_create(sample_rate, channels, OPUS_APPLICATION_AUDIO, &error);
    if (!encoder || error != OPUS_OK) return 3;
    opus_encoder_ctl(encoder, OPUS_SET_BITRATE(BITRATE));
    opus_encoder_ctl(encoder, OPUS_SET_VBR(1));
    opus_encoder_ctl(encoder, OPUS_SET_VBR_CONSTRAINT(1));
    opus_encoder_ctl(encoder, OPUS_SET_COMPLEXITY(5));
    opus_encoder_ctl(encoder, OPUS_SET_SIGNAL(OPUS_SIGNAL_MUSIC));
    size_t pcm_bytes = (size_t)frame_samples * channels * sizeof(int16_t);
    int16_t *pcm = malloc(pcm_bytes);
    uint8_t packet[MAX_PACKET];
    if (!pcm) { opus_encoder_destroy(encoder); return 4; }
    setvbuf(stdout, NULL, _IONBF, 0);
    while (read_frame(pcm, pcm_bytes) > 0) {
        int size = opus_encode(encoder, pcm, frame_samples, packet, MAX_PACKET);
        if (size < 0) break;
        uint8_t header[7] = {'O', 'P', (uint8_t)channels, (uint8_t)(sample_rate & 0xff), (uint8_t)((sample_rate >> 8) & 0xff), (uint8_t)(size & 0xff), (uint8_t)((size >> 8) & 0xff)};
        if (fwrite(header, 1, 7, stdout) != 7 || fwrite(packet, 1, (size_t)size, stdout) != (size_t)size) break;
    }
    free(pcm);
    opus_encoder_destroy(encoder);
    return 0;
}
