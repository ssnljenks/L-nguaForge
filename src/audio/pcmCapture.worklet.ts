/**
 * AudioWorklet processor for live-voice mic capture. Runs on the audio rendering thread, so
 * capture keeps working when the main thread is busy (unlike the deprecated ScriptProcessorNode).
 * Posts 100 ms chunks of 16 kHz Int16 PCM; each chunk's buffer is transferred, not copied.
 */
import {PcmChunker} from '../utils/liveAudio';

// AudioWorkletGlobalScope globals (not part of the DOM lib typings).
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly chunker = new PcmChunker(sampleRate, 16000, 100);

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      for (const {pcm, rms} of this.chunker.push(channel)) {
        this.port.postMessage({pcm: pcm.buffer, rms}, [pcm.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
