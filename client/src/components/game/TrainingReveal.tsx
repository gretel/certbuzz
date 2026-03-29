import { useEffect, useRef, useCallback } from 'react';
import type { Vote } from './ConfidenceGrid';

interface TrainingRevealProps {
  correctAnswerId: string;
  options: Array<{ id: string; text: string }>;
  votes: Array<Vote & { correct: boolean }>;
  containerRef: React.RefObject<HTMLDivElement>;
  onComplete: () => void;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  alpha: number;
  color: string;
}

const ANIM_DURATION = 3000;

export function TrainingReveal({ correctAnswerId, options, votes: _votes, containerRef, onComplete }: TrainingRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  const correctIdx = options.findIndex(o => o.id === correctAnswerId);

  const getQuadrantCenter = useCallback((idx: number, w: number, h: number) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    return {
      x: w * (col === 0 ? 0.25 : 0.75),
      y: h * (row === 0 ? 0.25 : 0.75),
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || correctIdx < 0) return;

    const resize = () => {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    particlesRef.current = [];
    const { x: cx, y: cy } = getQuadrantCenter(correctIdx, canvas.width, canvas.height);
    const colors = ['#facc15', '#fbbf24', '#f59e0b', '#ffffff', '#a3e635'];
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      particlesRef.current.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 2 + Math.random() * 4,
        alpha: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / ANIM_DURATION, 1);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;

      // Darken wrong quadrants
      const darkAlpha = Math.min(t * 1.8, 0.6);
      for (let i = 0; i < 4; i++) {
        if (i === correctIdx) continue;
        const col = i % 2;
        const row = Math.floor(i / 2);
        ctx.fillStyle = `rgba(0, 0, 0, ${darkAlpha})`;
        ctx.fillRect(col === 0 ? 0 : w / 2, row === 0 ? 0 : h / 2, w / 2, h / 2);
      }

      // Glow pulse on correct quadrant
      if (t > 0.1) {
        const pulseT = (t - 0.1) / 0.9;
        const glowAlpha = 0.3 + 0.2 * Math.sin(pulseT * Math.PI * 4);
        const { x: qx, y: qy } = getQuadrantCenter(correctIdx, w, h);
        const grad = ctx.createRadialGradient(qx, qy, 10, qx, qy, Math.min(w, h) * 0.35);
        grad.addColorStop(0, `rgba(250, 204, 21, ${glowAlpha})`);
        grad.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // Animate particles
      if (elapsed < 1500) {
        for (const p of particlesRef.current) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.05;
          p.alpha = Math.max(0, 1 - elapsed / 1200);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, w, h);
        onComplete();
      }
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [correctIdx, getQuadrantCenter, onComplete, containerRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-20 rounded-2xl"
    />
  );
}
