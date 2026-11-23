import {PcmChunker} from '../utils/liveAudio';
import pcmCaptureWorkletUrl from './pcmCapture.worklet.ts?worker&url';

export interface MicCapture {
  /** Stops capture and disconnects all nodes. Safe to call more than once. */
  stop: () => void;
}

export type PcmChunkHandler = (pcm: Int16Array, rms: number) => void;

/**
 * Streams microphone audio from `source` as 100 ms chunks of 16 kHz Int16 PCM.
 * Uses an AudioWorklet (off the main thread); falls back to the deprecated ScriptProcessorNode
 * only on browsers without AudioWorklet support.
 */
export async function startMicCapture(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  onChunk: PcmChunkHandler
): Promise<MicCapture> {
  // Processing nodes only run while connected to the destination; a muted gain avoids echo.
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  silentGain.connect(ctx.destination);

  let node: AudioNode;
  if (ctx.audioWorklet) {
    await ctx.audioWorklet.addModule(pcmCaptureWorkletUrl);
    const workletNode = new AudioWorkletNode(ctx, 'pcm-capture', {numberOfInputs: 1, numberOfOutputs: 1});
    workletNode.port.onmessage = (event: MessageEvent<{pcm: ArrayBuffer; rms: number}>) => {
      onChunk(new Int16Array(event.data.pcm), event.data.rms);
    };
    node = workletNode;
  } else {
    const chunker = new PcmChunker(ctx.sampleRate, 16000, 100);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      for (const {pcm, rms} of chunker.push(e.inputBuffer.getChannelData(0))) onChunk(pcm, rms);
    };
    node = processor;
  }

  source.connect(node);
  node.connect(silentGain);

  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (node instanceof AudioWorkletNode) node.port.onmessage = null;
      else (node as ScriptProcessorNode).onaudioprocess = null;
      for (const n of [source, node, silentGain]) {
        try {
          n.disconnect();
        } catch {
          // Already disconnected
        }
      }
    },
  };
}
