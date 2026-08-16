import React, { useEffect, useRef } from 'react';
import type { BackgroundAnimation } from '../types/music';

interface AnimatedBackgroundProps {
  type: BackgroundAnimation;
}

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({ type }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (type === 'off' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number | null = null;
    let isRunning = true;

    const getSafeWidth = () => Math.max(320, window.innerWidth || document.documentElement.clientWidth || 360);
    const getSafeHeight = () => Math.max(480, window.innerHeight || document.documentElement.clientHeight || 640);

    let width = (canvas.width = getSafeWidth());
    let height = (canvas.height = getSafeHeight());

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = getSafeWidth();
      height = canvas.height = getSafeHeight();
    };
    window.addEventListener('resize', handleResize);

    // =========================================================================
    // 1. METEOR SHOWER & STARFIELD
    // =========================================================================
    interface Star {
      x: number;
      y: number;
      radius: number;
      alpha: number;
      baseAlpha: number;
      twinkleSpeed: number;
    }
    const initStars = (): Star[] =>
      Array.from({ length: 60 }, () => {
        const baseAlpha = Math.random() * 0.6 + 0.3;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.5 + 0.5,
          alpha: baseAlpha,
          baseAlpha,
          twinkleSpeed: Math.random() * 0.03 + 0.01,
        };
      });

    let stars = initStars();

    const getThemeColor = (): string => {
      try {
        const cs = getComputedStyle(document.documentElement);
        const textCol = cs.getPropertyValue('--text-primary').trim();
        if (textCol && textCol !== '') return textCol;
        const accent = cs.getPropertyValue('--accent-color').trim();
        if (accent && accent !== '') return accent;
      } catch {
        // fallback
      }
      return '#ffffff';
    };

    interface Meteor {
      x: number;
      y: number;
      length: number;
      speed: number;
      thickness: number;
      alpha: number;
      isFireball: boolean;
    }

    const createMeteor = (isFireball = false): Meteor => {
      const speed = isFireball ? Math.random() * 2.2 + 1.5 : Math.random() * 1.2 + 0.7;
      return {
        x: Math.random() * (width * 1.3) - width * 0.1,
        y: Math.random() * -height * 0.5 - 40,
        length: isFireball ? Math.random() * 110 + 70 : Math.random() * 75 + 40,
        speed,
        thickness: isFireball ? Math.random() * 1.8 + 2.0 : Math.random() * 1.2 + 0.8,
        alpha: Math.random() * 0.3 + 0.6,
        isFireball,
      };
    };

    const meteors: Meteor[] = Array.from({ length: 14 }, () => createMeteor(false));

    interface Spark {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      alpha: number;
      color: string;
      life: number;
      maxLife: number;
    }
    const sparks: Spark[] = [];

    // Particles & Effects
    interface Particle {
      x: number;
      y: number;
      radius: number;
      vx: number;
      vy: number;
      alpha: number;
    }
    const particles: Particle[] = Array.from({ length: 30 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 2.0 + 0.8,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      alpha: Math.random() * 0.4 + 0.2,
    }));

    const cols = Math.max(10, Math.floor(width / 24));
    const matrixDrops: number[] = Array.from({ length: cols }, () => Math.random() * -50);

    interface RainDrop {
      x: number;
      y: number;
      length: number;
      speed: number;
      alpha: number;
    }
    const rainDrops: RainDrop[] = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      length: Math.random() * 20 + 10,
      speed: Math.random() * 8 + 10,
      alpha: Math.random() * 0.35 + 0.15,
    }));

    let auroraStep = 0;
    let frameCount = 0;

    // RENDER LOOP with Battery Saver Visibility Pause
    const render = () => {
      if (!isRunning || document.hidden) return;

      frameCount++;
      ctx.clearRect(0, 0, width, height);

      if (type === 'meteors') {
        const themeColor = getThemeColor();

        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          s.alpha = s.baseAlpha + Math.sin(frameCount * s.twinkleSpeed) * 0.25;
          const clampedAlpha = Math.max(0.15, Math.min(1, s.alpha));

          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${clampedAlpha})`;
          ctx.fill();
        }

        if (frameCount % 220 === 0 && Math.random() > 0.4) {
          meteors.push(createMeteor(true));
        }

        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i];
          const dx = m.speed * 1.0;
          const dy = m.speed * 1.1;

          m.x += dx;
          m.y += dy;

          if (Math.random() > 0.5) {
            sparks.push({
              x: m.x - dx * 0.5,
              y: m.y - dy * 0.5,
              vx: (Math.random() - 0.5) * 0.4,
              vy: (Math.random() - 0.5) * 0.4,
              radius: Math.random() * 1.0 + 0.4,
              alpha: m.alpha * 0.7,
              color: themeColor,
              life: 0,
              maxLife: Math.random() * 20 + 10,
            });
          }

          const tailX = m.x - m.length * 0.65;
          const tailY = m.y - m.length * 0.75;

          const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(0.3, themeColor);
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.beginPath();
          ctx.strokeStyle = grad;
          ctx.lineWidth = m.thickness;
          ctx.lineCap = 'round';
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(m.x, m.y, m.thickness * 1.1, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          if (m.y > height + 80 || m.x > width * 1.3) {
            if (m.isFireball) {
              meteors.splice(i, 1);
            } else {
              meteors[i] = createMeteor(false);
            }
          }
        }

        for (let i = sparks.length - 1; i >= 0; i--) {
          const sp = sparks[i];
          sp.x += sp.vx;
          sp.y += sp.vy;
          sp.life++;

          const fade = 1 - sp.life / sp.maxLife;
          if (fade <= 0) {
            sparks.splice(i, 1);
            continue;
          }

          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.radius, 0, Math.PI * 2);
          ctx.fillStyle = sp.color;
          ctx.globalAlpha = sp.alpha * fade;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      } else if (type === 'particles') {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;

          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
          ctx.fill();
        }
      } else if (type === 'matrix') {
        ctx.fillStyle = 'rgba(52, 211, 153, 0.7)';
        ctx.font = '14px monospace';

        const chars = '0123456789ABCDEF';
        for (let i = 0; i < matrixDrops.length; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * 24;
          const y = matrixDrops[i] * 24;
          ctx.fillText(char, x, y);

          if (y > height && Math.random() > 0.975) {
            matrixDrops[i] = 0;
          }
          matrixDrops[i]++;
        }
      } else if (type === 'rain') {
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.5)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';

        for (let i = 0; i < rainDrops.length; i++) {
          const r = rainDrops[i];
          r.y += r.speed;

          if (r.y > height) {
            r.y = Math.random() * -80;
            r.x = Math.random() * width;
          }

          ctx.beginPath();
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x, r.y + r.length);
          ctx.stroke();
        }
      } else if (type === 'aurora') {
        auroraStep += 0.008;
        const grad1 = ctx.createRadialGradient(
          width * 0.3 + Math.sin(auroraStep) * 80,
          height * 0.4 + Math.cos(auroraStep) * 60,
          20,
          width * 0.3,
          height * 0.4,
          width * 0.6
        );
        grad1.addColorStop(0, 'rgba(192, 132, 252, 0.3)');
        grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');

        const grad2 = ctx.createRadialGradient(
          width * 0.7 - Math.cos(auroraStep) * 100,
          height * 0.6 - Math.sin(auroraStep) * 80,
          20,
          width * 0.7,
          height * 0.6,
          width * 0.6
        );
        grad2.addColorStop(0, 'rgba(56, 189, 248, 0.3)');
        grad2.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad1;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = grad2;
        ctx.fillRect(0, 0, width, height);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      } else {
        if (animationFrameId === null && isRunning) {
          render();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    render();

    return () => {
      isRunning = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [type]);

  if (type === 'off') return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0 opacity-100"
    />
  );
};
