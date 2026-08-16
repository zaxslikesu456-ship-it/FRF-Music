import React, { useEffect, useRef } from 'react';
import { useAudio } from '../context/AudioContext';

export const AudioVisualizer: React.FC<{ height?: number; className?: string }> = ({
  height = 80,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { analyserNode, isPlaying, settings } = useAudio();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (analyserNode && isPlaying && settings.visualizerMode !== 'off') {
        if (settings.visualizerMode === 'bars') {
          analyserNode.getByteFrequencyData(dataArray);
          const barWidth = (canvas.width / bufferLength) * 1.8;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            const alpha = 0.4 + (dataArray[i] / 255) * 0.6;
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
          }
        } else if (settings.visualizerMode === 'wave') {
          analyserNode.getByteTimeDomainData(dataArray);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();

          const sliceWidth = (canvas.width * 1.0) / bufferLength;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);

            x += sliceWidth;
          }
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [analyserNode, isPlaying, settings.visualizerMode]);

  if (settings.visualizerMode === 'off') return null;

  return (
    <div className={`w-full flex items-center justify-center overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        width={320}
        height={height}
        className="w-full max-w-md h-auto rounded-lg bg-black/40 border border-app-theme"
      />
    </div>
  );
};
