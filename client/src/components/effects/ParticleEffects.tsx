import { useEffect, useRef, useCallback, useState } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  gravity: number;
}

interface ParticleEffectsProps {
  type: 'fireworks' | 'rain' | 'none';
  duration?: number; // ms
}

const FIREWORK_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96E6A1', '#DDA0DD', '#F7DC6F'];
const RAIN_COLORS = ['#87CEEB', '#B0C4DE', '#778899', '#A9A9A9'];

export function ParticleEffects({ type, duration = 20000 }: ParticleEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const [disabled, setDisabled] = useState(false);

  const handleCanvasClick = useCallback(() => {
    setDisabled(true);
    // Stop animation immediately
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  }, []);

  const createFireworkBurst = useCallback((x: number, y: number) => {
    const particles: Particle[] = [];
    const particleCount = 30 + Math.random() * 20;
    const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3,
        color,
        alpha: 1,
        decay: 0.015 + Math.random() * 0.01,
        gravity: 0.05,
      });
    }
    return particles;
  }, []);

  const createRainDrop = useCallback((canvasWidth: number) => {
    return {
      x: Math.random() * canvasWidth,
      y: -10,
      vx: -1 - Math.random(),
      vy: 8 + Math.random() * 6,
      size: 1 + Math.random() * 2,
      color: RAIN_COLORS[Math.floor(Math.random() * RAIN_COLORS.length)],
      alpha: 0.4 + Math.random() * 0.4,
      decay: 0,
      gravity: 0.1,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || type === 'none') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    startTimeRef.current = Date.now();
    particlesRef.current = [];

    let lastFireworkTime = 0;
    let lastRainTime = 0;

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed > duration) {
        // Fade out remaining particles
        if (particlesRef.current.length === 0) {
          return;
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Spawn new particles based on type
      if (elapsed < duration) {
        if (type === 'fireworks') {
          const now = Date.now();
          if (now - lastFireworkTime > 300 + Math.random() * 500) {
            const x = canvas.width * 0.2 + Math.random() * canvas.width * 0.6;
            const y = canvas.height * 0.2 + Math.random() * canvas.height * 0.4;
            particlesRef.current.push(...createFireworkBurst(x, y));
            lastFireworkTime = now;
          }
        } else if (type === 'rain') {
          const now = Date.now();
          if (now - lastRainTime > 20) {
            for (let i = 0; i < 3; i++) {
              particlesRef.current.push(createRainDrop(canvas.width));
            }
            lastRainTime = now;
          }
        }
      }

      // Update and draw particles
      particlesRef.current = particlesRef.current.filter(particle => {
        // Update physics
        particle.vy += particle.gravity;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.alpha -= particle.decay;

        // Remove dead particles
        if (particle.alpha <= 0) return false;
        if (type === 'rain' && particle.y > canvas.height + 10) return false;

        // Draw particle
        ctx.save();
        ctx.globalAlpha = particle.alpha;
        
        if (type === 'fireworks') {
          // Draw as glowing circle
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
          ctx.fillStyle = particle.color;
          ctx.fill();
          
          // Add glow effect
          ctx.shadowBlur = 10;
          ctx.shadowColor = particle.color;
          ctx.fill();
        } else if (type === 'rain') {
          // Draw as line (raindrop)
          ctx.beginPath();
          ctx.moveTo(particle.x, particle.y);
          ctx.lineTo(particle.x + particle.vx * 2, particle.y + particle.vy * 2);
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = particle.size;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        
        ctx.restore();
        return true;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [type, duration, createFireworkBurst, createRainDrop]);

  if (type === 'none' || disabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-50 cursor-pointer"
      style={{ 
        background: type === 'rain' ? 'rgba(0,0,0,0.1)' : 'transparent' 
      }}
      onClick={handleCanvasClick}
      title="Klicken zum Deaktivieren"
    />
  );
}
