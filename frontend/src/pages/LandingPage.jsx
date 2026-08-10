import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'

/* ─── tiny hook: count up a number on mount ─────────────────── */
function useCountUp (target, duration = 1600, start = false) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!start) return
    let raf, startTime
    const step = (ts) => {
      if (!startTime) startTime = ts
      const progress = Math.min((ts - startTime) / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      setVal(Math.round(ease * target))
      if (progress < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, start])
  return val
}

/* ─── tiny hook: intersection observer ──────────────────────── */
function useInView (threshold = 0.15) {
  const ref     = useRef(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect() } }, { threshold })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, vis]
}

const SQL_DEMO = `SELECT department,
       COUNT(*)        AS total,
       AVG(salary)     AS avg_salary,
       MAX(salary)     AS top_salary
FROM   employees
WHERE  age > 25
GROUP  BY department
ORDER  BY total DESC`

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 5h14M3 10h9M3 15h11" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="16" cy="15" r="3" fill="#3b82f6" opacity=".2" stroke="#3b82f6" strokeWidth="1.2"/>
        <path d="M15 15l.8.8 1.8-1.8" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Predicate Pushdown',
    desc: 'WHERE filters execute row-by-row during CSV streaming on each worker. Non-matching rows never touch memory or cross the network.',
    badge: 'Performance',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="#10b981" strokeWidth="1.4"/>
        <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="#10b981" strokeWidth="1.4"/>
        <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="#10b981" strokeWidth="1.4"/>
        <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="#10b981" strokeWidth="1.4" opacity=".4"/>
        <path d="M14.5 13v4M12.5 15h4" stroke="#10b981" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Partial Aggregation',
    desc: 'MapReduce-style GROUP BY: workers build local hash maps, coordinator merges compact objects instead of millions of raw rows.',
    badge: 'Architecture',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 3v14M3 10h14" stroke="#f59e0b" strokeWidth="1.4" strokeLinecap="round" opacity=".3"/>
        <circle cx="10" cy="10" r="7" stroke="#f59e0b" strokeWidth="1.4"/>
        <path d="M7 10l2 2 4-4" stroke="#f59e0b" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Fault Recovery',
    desc: 'Workers heartbeat every 5 s. Timed-out tasks are automatically detected and reassigned to healthy workers — up to 3 attempts.',
    badge: 'Reliability',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 10h3l2-5 3 10 2-7 2 4 2-2h2" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Live Streaming',
    desc: 'Results flow to the browser via WebSocket as workers compute. No waiting for the full query — rows appear in real time.',
    badge: 'Real-time',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M4 16V8l6-5 6 5v8" stroke="#e879f9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="8" y="12" width="4" height="4" rx="0.5" stroke="#e879f9" strokeWidth="1.2"/>
      </svg>
    ),
    title: 'EXPLAIN Endpoint',
    desc: 'Like PostgreSQL\'s EXPLAIN — inspect the full execution plan before running. See partition assignment, predicate pushdown, and aggregation strategy.',
    badge: 'Observability',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="#34d399" strokeWidth="1.4"/>
        <path d="M7 10l1.5 1.5L13 8" stroke="#34d399" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Full Observability',
    desc: 'OpenTelemetry distributed traces, Prometheus metrics, and Grafana dashboards — every query tracked end-to-end across all workers.',
    badge: 'Monitoring',
  },
]

const STEPS = [
  { step: '01', title: 'Upload CSV',     desc: 'Drop any CSV file. QueryForge partitions it across 3 worker nodes automatically.' },
  { step: '02', title: 'Write SQL',      desc: 'Use standard SQL — SELECT, WHERE, GROUP BY, ORDER BY, LIMIT, COUNT, SUM, AVG, MAX, MIN.' },
  { step: '03', title: 'Explain first',  desc: 'Hit Explain to preview the execution plan: predicate pushdown, aggregation strategy, partition assignment.' },
  { step: '04', title: 'Run & stream',   desc: 'Workers execute in parallel. Results stream live to your browser via WebSocket as they arrive.' },
]

const TECH = [
  { name: 'Node.js',      role: 'Coordinator & Workers' },
  { name: 'gRPC',         role: 'Inter-service RPC' },
  { name: 'PostgreSQL',   role: 'Metadata store' },
  { name: 'MinIO',        role: 'S3-compatible storage' },
  { name: 'React',        role: 'Frontend' },
  { name: 'WebSocket',    role: 'Live streaming' },
  { name: 'Prometheus',   role: 'Metrics' },
  { name: 'Grafana',      role: 'Dashboards' },
  { name: 'OpenTelemetry','role': 'Distributed tracing' },
  { name: 'Docker',       role: 'Orchestration' },
]

/* ─── Animated SQL typewriter ───────────────────────────────── */
function SqlTypewriter () {
  const [displayed, setDisplayed] = useState('')
  const [cursor,    setCursor]    = useState(true)

  useEffect(() => {
    let i = 0
    const id = setInterval(() => {
      setDisplayed(SQL_DEMO.slice(0, i + 1))
      i++
      if (i >= SQL_DEMO.length) clearInterval(id)
    }, 28)
    const blinkId = setInterval(() => setCursor(c => !c), 530)
    return () => { clearInterval(id); clearInterval(blinkId) }
  }, [])

  return (
    <pre className="text-left font-mono text-xs sm:text-sm text-emerald-300/90 leading-relaxed whitespace-pre-wrap">
      {displayed}
      <span className={`inline-block w-[2px] h-[1em] bg-accent ml-px align-middle transition-opacity ${cursor ? 'opacity-100' : 'opacity-0'}`} />
    </pre>
  )
}

/* ─── Benchmark bar ──────────────────────────────────────────── */
function BenchBar ({ label, ms, max, color, inView }) {
  const pct = (ms / max) * 100
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-ink-faint w-32 flex-shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-surface rounded overflow-hidden border border-border">
        <div
          className="h-full rounded flex items-center justify-end pr-2 transition-all duration-700 ease-out"
          style={{ width: inView ? `${pct}%` : '0%', background: color, transitionDelay: '150ms' }}
        >
          <span className="text-[10px] font-mono font-bold text-white">{ms.toLocaleString()}ms</span>
        </div>
      </div>
    </div>
  )
}

/* ─── Main component ─────────────────────────────────────────── */
export default function LandingPage () {
  const [statsRef, statsVis] = useInView()
  const [benchRef, benchVis] = useInView()

  const rows       = useCountUp(2_000_000, 1800, statsVis)
  const speedup    = useCountUp(170,        1400, statsVis)
  const throughput = useCountUp(570_000,    2000, statsVis)

  return (
    <div className="min-h-screen bg-void text-ink overflow-x-hidden">

      {/* ── Background layers ──────────────────────────────────── */}
      <div aria-hidden className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(rgba(41,48,73,0.13) 1px,transparent 1px),linear-gradient(90deg,rgba(41,48,73,0.13) 1px,transparent 1px)`,
        backgroundSize: '32px 32px',
        maskImage: 'radial-gradient(ellipse 90% 55% at 50% 0%,black 10%,transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse 90% 55% at 50% 0%,black 10%,transparent 75%)',
      }} />
      <div aria-hidden className="fixed top-0 inset-x-0 h-[600px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 40% at 50% -8%,rgba(59,130,246,0.11) 0%,transparent 70%)' }} />

      {/* ── Nav ────────────────────────────────────────────────── */}
      <nav className="relative z-30 flex items-center justify-between px-6 py-4 border-b border-border/40 backdrop-blur-sm bg-void/70">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h8M2 12h9" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="13" cy="12" r="2.5" fill="#3b82f6"/>
              <path d="M12 12l.8.8 1.6-1.6" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-sm font-bold tracking-tight">QueryForge</span>
        </div>
        <div className="hidden md:flex items-center gap-6 text-xs text-ink-muted">
          <a href="#features" className="hover:text-ink transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-ink transition-colors">How it works</a>
          <a href="#benchmarks" className="hover:text-ink transition-colors">Benchmarks</a>
          <a href="#tech" className="hover:text-ink transition-colors">Stack</a>
        </div>
        <Link to="/app" className="btn-primary text-xs px-4 py-2">
          Open App
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </nav>

      {/* ── Hero 3D ────────────────────────────────────────────── */}
      <Hero3D />

      {/* ── Stats ticker ───────────────────────────────────────── */}
      <section ref={statsRef} className="relative z-10 py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { value: rows.toLocaleString(), suffix: ' rows',   label: 'Max dataset tested',        sub: '5M rows also tested',           color: '#3b82f6', glow: 'rgba(59,130,246,0.12)' },
              { value: (speedup/100).toFixed(2)+'×', suffix: '',  label: 'Faster than single machine', sub: 'vs baseline on 2M-row CSV',     color: '#10b981', glow: 'rgba(16,185,129,0.12)' },
              { value: Math.round(throughput/1000)+'K', suffix: ' rows/s', label: 'Throughput',       sub: 'at full 3-worker parallelism',  color: '#f59e0b', glow: 'rgba(245,158,11,0.12)'  },
            ].map((s, i) => (
              <div key={i} className="relative rounded-2xl overflow-hidden p-px"
                style={{ background: `linear-gradient(135deg, ${s.color}30 0%, transparent 60%)` }}>
                <div className="rounded-2xl px-8 py-8 h-full relative"
                  style={{ background: 'linear-gradient(135deg, #141820 0%, #0f1217 100%)' }}>
                  <div aria-hidden className="absolute inset-0 rounded-2xl pointer-events-none"
                    style={{ background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${s.glow} 0%, transparent 70%)` }} />
                  <div className="text-5xl font-bold font-mono tabular-nums relative"
                    style={{ color: s.color }}>
                    {s.value}<span className="text-2xl text-ink-faint">{s.suffix}</span>
                  </div>
                  <div className="text-sm font-semibold text-ink mt-2 relative">{s.label}</div>
                  <div className="text-xs text-ink-faint mt-1 relative">{s.sub}</div>
                  {/* Corner dot */}
                  <div className="absolute top-4 right-4 w-2 h-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Architecture ───────────────────────────────────────── */}
      <section className="relative z-10 py-20 px-6 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          {/* Section header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 text-[10px] text-ink-faint uppercase tracking-widest font-semibold mb-4">
              System Design
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-ink">How the engine works</h2>
            <p className="text-ink-muted text-sm mt-3 max-w-xl mx-auto">
              Every component has a single responsibility. The coordinator orchestrates; workers execute; MinIO stores.
            </p>
          </div>
          <ArchDiagramV2 />
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="relative z-10 py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 text-[10px] text-ink-faint uppercase tracking-widest font-semibold mb-4">
              Features
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-ink">Built for scale from day one</h2>
            <p className="text-ink-muted text-sm mt-3">Every design decision targets the bottleneck it solves.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => <FeatureCard key={i} {...f} delay={i * 60} />)}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────── */}
      <section id="how-it-works" className="relative z-10 py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 text-[10px] text-ink-faint uppercase tracking-widest font-semibold mb-4">
              Workflow
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-ink">From upload to result in 4 steps</h2>
          </div>
          <StepsTimeline />
        </div>
      </section>

      {/* ── Benchmarks ─────────────────────────────────────────── */}
      <section id="benchmarks" ref={benchRef} className="relative z-10 py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 text-[10px] text-ink-faint uppercase tracking-widest font-semibold mb-4">
              Benchmarks
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-ink">Real numbers, real dataset</h2>
            <p className="text-ink-muted text-sm mt-3">2,000,000-row CSV · 3 workers · measured end-to-end</p>
          </div>
          <BenchSection inView={benchVis} />
        </div>
      </section>

      {/* ── Tech stack ─────────────────────────────────────────── */}
      <section id="tech" className="relative z-10 py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 text-[10px] text-ink-faint uppercase tracking-widest font-semibold mb-4">
              Stack
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-ink">Purpose-built technology</h2>
            <p className="text-ink-muted text-sm mt-3">Every piece chosen for a specific reason.</p>
          </div>
          <TechGrid />
        </div>
      </section>

      {/* ── CTA band ───────────────────────────────────────────── */}
      <section className="relative z-10 py-28 px-6 overflow-hidden">
        {/* Background glow */}
        <div aria-hidden className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(59,130,246,0.07) 0%, transparent 70%)' }} />
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent/20 bg-accent/5 text-xs text-accent mb-6">
            <span className="status-dot bg-accent animate-pulse-dot" />
            One command away
          </div>
          <h2 className="text-3xl sm:text-5xl font-bold mb-5 leading-tight">
            Ready to forge<br/>
            <span style={{ background: 'linear-gradient(90deg,#3b82f6,#818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              distributed queries?
            </span>
          </h2>
          <p className="text-ink-muted mb-3">
            Spin up all 9 services with a single command.
          </p>
          {/* Command block */}
          <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl font-mono text-sm text-emerald-300/90 mb-10"
            style={{ background: '#0f1217', border: '1px solid rgba(41,48,73,0.8)', boxShadow: '0 2px 20px rgba(0,0,0,0.4)' }}>
            <span className="text-ink-ghost select-none">$</span>
            <span>docker compose up --build</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/app" className="btn-primary px-8 py-3.5 text-sm">
              Open QueryForge
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7h9M8.5 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <a href="https://github.com/princekr969/QueryForge-" target="_blank" rel="noopener noreferrer" className="btn-ghost px-6 py-3.5 text-sm">
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-border/40 px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-ghost">
          <div className="flex items-center gap-2">
            <span>QueryForge © 2026</span>
            <span>·</span>
            <span>Built by Prince Kumar</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Predicate Pushdown</span><span>·</span>
            <span>Partial Aggregation</span><span>·</span>
            <span>Fault Recovery</span><span>·</span>
            <span>Live Streaming</span>
          </div>
        </div>
      </footer>

    </div>
  )
}

/* ─── Particle canvas ────────────────────────────────────────── */
function ParticleField () {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf
    let W = canvas.offsetWidth
    let H = canvas.offsetHeight
    canvas.width  = W
    canvas.height = H

    const N = 90
    const particles = Array.from({ length: N }, () => ({
      x:    Math.random() * W,
      y:    Math.random() * H,
      r:    Math.random() * 1.4 + 0.3,
      vx:   (Math.random() - 0.5) * 0.18,
      vy:   (Math.random() - 0.5) * 0.18,
      a:    Math.random() * 0.5 + 0.15,
      hue:  Math.random() > 0.7 ? 220 : 210,
    }))

    function draw () {
      ctx.clearRect(0, 0, W, H)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x = W
        if (p.x > W) p.x = 0
        if (p.y < 0) p.y = H
        if (p.y > H) p.y = 0

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue},80%,70%,${p.a})`
        ctx.fill()
      }
      // draw connecting lines between close particles
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 90) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(59,130,246,${(1 - dist / 90) * 0.12})`
            ctx.lineWidth = 0.6
            ctx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }

    draw()

    const ro = new ResizeObserver(() => {
      W = canvas.offsetWidth
      H = canvas.offsetHeight
      canvas.width  = W
      canvas.height = H
    })
    ro.observe(canvas)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  )
}

/* ─── 3D floating node ───────────────────────────────────────── */
function FloatingNode ({ x, y, size, color, delay, label, depth }) {
  return (
    <div
      className="absolute select-none"
      style={{
        left: `${x}%`,
        top:  `${y}%`,
        transform: `translateZ(${depth}px)`,
        animation: `float-node 4s ease-in-out infinite`,
        animationDelay: `${delay}s`,
      }}
    >
      <div
        className="rounded-xl flex items-center justify-center font-mono text-[9px] font-bold text-white/80 border"
        style={{
          width: size, height: size,
          background: `linear-gradient(135deg, ${color}22 0%, ${color}08 100%)`,
          borderColor: `${color}40`,
          boxShadow: `0 0 ${size / 2}px ${color}30, inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}
      >
        {label}
      </div>
    </div>
  )
}

/* ─── 3D orbiting ring ───────────────────────────────────────── */
function OrbitRing ({ size, color, tilt, speed, opacity }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 rounded-full border pointer-events-none"
      style={{
        width: size, height: size,
        marginLeft: -size / 2, marginTop: -size / 2,
        borderColor: `${color}${Math.round(opacity * 255).toString(16).padStart(2,'0')}`,
        borderWidth: 1,
        transform: `rotateX(${tilt}deg) rotateY(${tilt * 0.3}deg)`,
        animation: `spin-ring ${speed}s linear infinite`,
        boxShadow: `0 0 12px ${color}15`,
      }}
    />
  )
}

/* ─── Central 3D data-core ───────────────────────────────────── */
function DataCore ({ mouseX, mouseY }) {
  const rotX = (mouseY * 18).toFixed(1)
  const rotY = (mouseX * -18).toFixed(1)

  return (
    <div
      className="relative"
      style={{
        transform: `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg)`,
        transition: 'transform 0.12s ease-out',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* Outer shell */}
      <div
        className="w-48 h-48 sm:w-60 sm:h-60 rounded-3xl border relative"
        style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(41,48,73,0.6) 50%, rgba(129,140,248,0.08) 100%)',
          borderColor: 'rgba(59,130,246,0.35)',
          boxShadow: '0 0 60px rgba(59,130,246,0.18), 0 0 120px rgba(59,130,246,0.08), inset 0 1px 0 rgba(255,255,255,0.07)',
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Inner face */}
        <div
          className="absolute inset-4 rounded-2xl flex flex-col items-center justify-center gap-2"
          style={{
            background: 'linear-gradient(160deg, rgba(11,13,15,0.9) 0%, rgba(20,24,32,0.95) 100%)',
            border: '1px solid rgba(59,130,246,0.2)',
            transform: 'translateZ(12px)',
            boxShadow: 'inset 0 0 30px rgba(59,130,246,0.06)',
          }}
        >
          {/* Logo mark */}
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(59,130,246,0.05))', border: '1px solid rgba(59,130,246,0.3)' }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M3 5.5h16M3 11h11M3 16.5h13" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="18" cy="16.5" r="3.5" fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth="1.5"/>
              <path d="M16.5 16.5l1.1 1.1 2.2-2.2" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="text-center">
            <div className="text-xs sm:text-sm font-bold text-ink tracking-tight">QueryForge</div>
            <div className="text-[8px] sm:text-[9px] text-ink-faint font-mono">Distributed SQL</div>
          </div>
          {/* Live pulse */}
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[8px] text-success-text font-mono">3 workers · live</span>
          </div>
        </div>

        {/* Corner accents */}
        {[
          'top-2 left-2', 'top-2 right-2', 'bottom-2 left-2', 'bottom-2 right-2',
        ].map((pos, i) => (
          <div key={i} className={`absolute ${pos} w-2 h-2 rounded-sm`}
            style={{ background: 'rgba(59,130,246,0.5)', boxShadow: '0 0 6px rgba(59,130,246,0.6)' }} />
        ))}
      </div>

      {/* Side face — right */}
      <div
        className="absolute top-3 -right-3 bottom-3 w-3 rounded-r-lg"
        style={{
          background: 'linear-gradient(180deg, rgba(59,130,246,0.25) 0%, rgba(41,48,73,0.4) 100%)',
          transform: 'rotateY(90deg)',
          transformOrigin: 'left center',
        }}
      />
      {/* Bottom face */}
      <div
        className="absolute left-3 right-3 -bottom-3 h-3 rounded-b-lg"
        style={{
          background: 'linear-gradient(90deg, rgba(59,130,246,0.2) 0%, rgba(41,48,73,0.3) 100%)',
          transform: 'rotateX(-90deg)',
          transformOrigin: 'top center',
        }}
      />
    </div>
  )
}

/* ─── Hero3D ─────────────────────────────────────────────────── */
function Hero3D () {
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const heroRef = useRef(null)

  const handleMouseMove = useCallback((e) => {
    const rect = heroRef.current?.getBoundingClientRect()
    if (!rect) return
    setMouse({
      x: ((e.clientX - rect.left) / rect.width  - 0.5) * 2,
      y: ((e.clientY - rect.top)  / rect.height - 0.5) * 2,
    })
  }, [])

  const nodes = [
    { x: 8,  y: 18, size: 52, color: '#3b82f6', delay: 0,   label: 'W1', depth: 20 },
    { x: 14, y: 68, size: 44, color: '#10b981', delay: 0.6, label: 'W2', depth: 35 },
    { x: 82, y: 22, size: 48, color: '#818cf8', delay: 1.2, label: 'W3', depth: 15 },
    { x: 78, y: 72, size: 40, color: '#f59e0b', delay: 1.8, label: 'PG', depth: 28 },
    { x: 50, y: 8,  size: 36, color: '#e879f9', delay: 0.9, label: 'S3', depth: 40 },
    { x: 88, y: 48, size: 34, color: '#34d399', delay: 2.1, label: 'GF', depth: 22 },
    { x: 4,  y: 44, size: 30, color: '#60a5fa', delay: 1.5, label: 'WS', depth: 45 },
  ]

  return (
    <section
      ref={heroRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setMouse({ x: 0, y: 0 })}
      className="relative overflow-hidden"
      style={{ minHeight: '88vh' }}
    >
      {/* Deep space background */}
      <div className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(59,130,246,0.18) 0%, transparent 60%),
            radial-gradient(ellipse 40% 60% at 85% 50%, rgba(129,140,248,0.1) 0%, transparent 55%),
            radial-gradient(ellipse 35% 50% at 10% 60%, rgba(16,185,129,0.07) 0%, transparent 55%),
            linear-gradient(180deg, #0b0d0f 0%, #0d1018 50%, #0b0d0f 100%)
          `,
        }}
      />

      {/* Animated grid — perspective tilt */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(rgba(41,48,73,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(41,48,73,0.2) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          transform: 'perspective(600px) rotateX(55deg) translateY(10%) scaleX(1.4)',
          transformOrigin: '50% 100%',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 55%)',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 55%)',
          opacity: 0.7,
        }}
      />

      {/* Particle field */}
      <ParticleField />

      {/* Orbiting rings — around the center core */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative" style={{ width: 0, height: 0 }}>
          <OrbitRing size={320} color="#3b82f6" tilt={68} speed={18} opacity={0.25} />
          <OrbitRing size={440} color="#818cf8" tilt={55} speed={28} opacity={0.15} />
          <OrbitRing size={560} color="#10b981" tilt={72} speed={40} opacity={0.1}  />
        </div>
      </div>

      {/* Floating worker / service nodes */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `perspective(1200px) rotateX(${mouse.y * 3}deg) rotateY(${mouse.x * -3}deg)`,
          transition: 'transform 0.15s ease-out',
          transformStyle: 'preserve-3d',
        }}
      >
        {nodes.map((n, i) => <FloatingNode key={i} {...n} />)}
      </div>

      {/* Connection beams — SVG lines from nodes to center */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        {nodes.map((n, i) => (
          <line key={i}
            x1={`${n.x}%`}  y1={`${n.y}%`}
            x2="50%"         y2="50%"
            stroke={n.color}
            strokeWidth="0.5"
            strokeOpacity="0.2"
            strokeDasharray="4 6"
          />
        ))}
      </svg>

      {/* Main content — left aligned like the reference */}
      <div className="relative z-10 flex items-center min-h-[88vh] px-6 sm:px-12 lg:px-20">
        <div className="flex flex-col lg:flex-row items-center lg:items-center justify-between w-full max-w-7xl mx-auto gap-12 py-20">

          {/* Left — text + CTA */}
          <div className="flex-1 max-w-xl lg:max-w-2xl" style={{ animation: 'fade-in 0.8s cubic-bezier(0.16,1,0.3,1) forwards' }}>
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
              style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="text-xs text-accent font-medium tracking-wide">Production-grade · Open source</span>
            </div>

            {/* Main headline */}
            <h1 className="font-bold tracking-tight leading-[1.05] mb-6"
              style={{ fontSize: 'clamp(2.4rem, 5.5vw, 4.2rem)' }}>
              <span style={{
                background: 'linear-gradient(90deg, #e2e8f0 0%, #94a3b8 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>
                Distributed SQL
              </span>
              <br />
              <span style={{
                background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 40%, #818cf8 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>
                at scale.
              </span>
            </h1>

            <p className="text-sm sm:text-base leading-relaxed mb-8"
              style={{ color: 'rgba(136,146,164,0.9)', maxWidth: '36rem' }}>
              Upload any CSV, write standard SQL, and QueryForge distributes execution
              across 3 parallel worker nodes — with predicate pushdown, partial aggregation,
              fault recovery, and live WebSocket streaming to your browser.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 mb-8">
              {['Predicate Pushdown', 'Partial Aggregation', 'Fault Recovery', 'Live Streaming', 'EXPLAIN'].map(f => (
                <span key={f} className="text-[10px] px-2.5 py-1 rounded-full font-medium"
                  style={{ background: 'rgba(41,48,73,0.6)', border: '1px solid rgba(41,48,73,1)', color: 'rgba(136,146,164,0.8)' }}>
                  {f}
                </span>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <Link to="/app" className="btn-primary px-7 py-3 text-sm">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 2.5l8 4.5-8 4.5V2.5z" fill="currentColor"/>
                </svg>
                Launch Engine
              </Link>
              <a href="https://github.com/princekr969/QueryForge-" target="_blank" rel="noopener noreferrer"
                className="btn-ghost px-6 py-3 text-sm">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M7 1a6 6 0 0 0-1.9 11.7c.3.05.4-.13.4-.29v-1C3.7 11.75 3.35 10.5 3.35 10.5c-.27-.7-.67-.88-.67-.88-.55-.37.04-.37.04-.37.6.04.92.62.92.62.54.92 1.4.65 1.75.5.05-.39.21-.65.38-.8-1.34-.15-2.74-.67-2.74-2.97 0-.66.24-1.19.62-1.61-.06-.15-.27-.76.06-1.59 0 0 .5-.16 1.65.62A5.77 5.77 0 0 1 7 4.39c.51 0 1.03.07 1.51.2 1.15-.78 1.65-.62 1.65-.62.33.83.12 1.44.06 1.59.39.42.62.95.62 1.61 0 2.31-1.41 2.82-2.75 2.97.22.19.41.55.41 1.11v1.65c0 .16.11.35.41.29A6 6 0 0 0 7 1z"/>
                </svg>
                View on GitHub
              </a>
              <a href="#features"
                className="hidden sm:inline-flex items-center gap-2 px-5 py-3 text-sm text-ink-faint hover:text-ink transition-colors">
                See how it works
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M2 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Right — 3D data core */}
          <div className="flex-shrink-0 flex items-center justify-center relative"
            style={{ animation: 'fade-in 1s cubic-bezier(0.16,1,0.3,1) 0.2s both' }}>
            {/* Ambient glow behind core */}
            <div aria-hidden className="absolute w-72 h-72 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(ellipse, rgba(59,130,246,0.15) 0%, transparent 70%)', filter: 'blur(30px)' }} />
            <DataCore mouseX={mouse.x} mouseY={mouse.y} />
          </div>

        </div>
      </div>

      {/* Bottom fade */}
      <div aria-hidden className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, #0b0d0f)' }} />

      <style>{`
        @keyframes float-node {
          0%, 100% { transform: translateY(0px) translateZ(var(--depth, 20px)); }
          50%       { transform: translateY(-8px) translateZ(var(--depth, 20px)); }
        }
        @keyframes spin-ring {
          from { transform: rotateX(var(--tilt, 65deg)) rotateZ(0deg); }
          to   { transform: rotateX(var(--tilt, 65deg)) rotateZ(360deg); }
        }
      `}</style>
    </section>
  )
}

/* ─── Architecture diagram V2 ────────────────────────────────── */
function ArchDiagramV2 () {
  const layers = [
    {
      label: 'Frontend', sublabel: 'React + Vite · port 5173',
      items: ['SQL Editor', 'Dataset Upload', '⚡ Explain', 'Live Results', 'Worker Dashboard'],
      color: '#3b82f6', glow: 'rgba(59,130,246,0.08)',
    },
    {
      label: 'Coordinator', sublabel: 'Node.js + Express · port 3000 / 50050',
      items: ['SQL Parser', 'Query Planner', 'Job Manager', 'Result Merger', 'Fault Monitor', 'WS Broadcaster'],
      color: '#818cf8', glow: 'rgba(129,140,248,0.08)',
    },
  ]

  const workers = [
    { id: 'Worker 1', steps: ['Download partition', 'Apply WHERE', 'Local GROUP BY', 'Stream results'] },
    { id: 'Worker 2', steps: ['Download partition', 'Apply WHERE', 'Local GROUP BY', 'Stream results'] },
    { id: 'Worker 3', steps: ['Download partition', 'Apply WHERE', 'Local GROUP BY', 'Stream results'] },
  ]

  const infra = [
    { name: 'MinIO (S3)', desc: 'datasets · partitions', color: '#f59e0b', port: '9000' },
    { name: 'PostgreSQL', desc: 'metadata · jobs · tasks', color: '#60a5fa', port: '5432' },
    { name: 'Prometheus', desc: 'metrics scraping', color: '#f87171', port: '9090' },
    { name: 'Grafana',    desc: 'dashboards', color: '#34d399', port: '3001' },
  ]

  return (
    <div className="space-y-3">
      {/* Top layers */}
      {layers.map((l, li) => (
        <div key={li}>
          <div className="relative rounded-2xl overflow-hidden p-px"
            style={{ background: `linear-gradient(135deg, ${l.color}35 0%, transparent 70%)` }}>
            <div className="rounded-2xl px-6 py-5"
              style={{ background: `linear-gradient(135deg, #141820 0%, #0f1217 100%)` }}>
              <div aria-hidden className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{ background: `radial-gradient(ellipse 60% 80% at 50% 0%, ${l.glow} 0%, transparent 70%)` }} />
              <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-shrink-0">
                  <div className="text-sm font-bold" style={{ color: l.color }}>{l.label}</div>
                  <div className="text-[10px] text-ink-faint font-mono mt-0.5">{l.sublabel}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                  {l.items.map(item => (
                    <span key={item} className="text-[10px] px-2.5 py-1 rounded-full font-medium"
                      style={{ background: `${l.color}12`, border: `1px solid ${l.color}25`, color: `${l.color}cc` }}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Arrow */}
          <div className="flex justify-center py-2">
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-px h-4" style={{ background: `linear-gradient(to bottom, ${l.color}60, transparent)` }} />
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke={l.color} strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <div className="text-[9px] text-ink-ghost font-mono">
                {li === 0 ? 'REST + WebSocket' : 'gRPC ExecuteTask'}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Workers row */}
      <div className="grid grid-cols-3 gap-3">
        {workers.map((w, i) => (
          <div key={i} className="relative rounded-xl overflow-hidden p-px"
            style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.3) 0%, transparent 70%)' }}>
            <div className="rounded-xl px-4 py-4"
              style={{ background: 'linear-gradient(135deg, #141820 0%, #0f1217 100%)' }}>
              <div className="text-xs font-bold text-success-text mb-2">{w.id}</div>
              <div className="space-y-1">
                {w.steps.map((s, si) => (
                  <div key={si} className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-ink-ghost w-3">0{si+1}</span>
                    <span className="text-[10px] text-ink-faint">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Arrow down to storage */}
      <div className="flex justify-center py-2">
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-px h-4" style={{ background: 'linear-gradient(to bottom, rgba(16,185,129,0.5), transparent)' }} />
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1l4 4 4-4" stroke="rgba(16,185,129,0.4)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div className="text-[9px] text-ink-ghost font-mono">S3 GET · PostgreSQL · Metrics</div>
        </div>
      </div>

      {/* Infrastructure row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {infra.map((inf, i) => (
          <div key={i} className="relative rounded-xl overflow-hidden p-px"
            style={{ background: `linear-gradient(135deg, ${inf.color}25 0%, transparent 70%)` }}>
            <div className="rounded-xl px-4 py-3.5"
              style={{ background: 'linear-gradient(135deg, #141820 0%, #0f1217 100%)' }}>
              <div className="text-xs font-bold mb-0.5" style={{ color: inf.color }}>{inf.name}</div>
              <div className="text-[10px] text-ink-faint">{inf.desc}</div>
              <div className="text-[9px] font-mono text-ink-ghost mt-1">:{inf.port}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Steps timeline ─────────────────────────────────────────── */
function StepsTimeline () {
  const STEP_COLORS = ['#3b82f6', '#818cf8', '#10b981', '#f59e0b']
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
      {/* Horizontal connector on md+ */}
      <div className="hidden md:block absolute top-8 left-[12.5%] right-[12.5%] h-px"
        style={{ background: 'linear-gradient(90deg, transparent, #293049 20%, #293049 80%, transparent)' }} />

      {STEPS.map((s, i) => {
        const [ref, vis] = [useRef(null), useState(false)]
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const [cardRef, cardVis] = useInView(0.1)
        return (
          <div key={i} ref={cardRef}
            style={{
              opacity: cardVis ? 1 : 0,
              transform: cardVis ? 'translateY(0)' : 'translateY(20px)',
              transition: `opacity 0.5s ease ${i*100}ms, transform 0.5s cubic-bezier(0.16,1,0.3,1) ${i*100}ms`,
            }}
          >
            {/* Step number bubble */}
            <div className="flex md:flex-col md:items-center gap-4 md:gap-3">
              <div className="flex-shrink-0 w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center text-sm md:text-base font-bold font-mono relative"
                style={{
                  background: `linear-gradient(135deg, ${STEP_COLORS[i]}20, ${STEP_COLORS[i]}08)`,
                  border: `1px solid ${STEP_COLORS[i]}35`,
                  color: STEP_COLORS[i],
                  boxShadow: `0 0 20px ${STEP_COLORS[i]}15`,
                }}>
                {s.step}
                {/* Connector dot */}
                <div className="hidden md:block absolute -bottom-[calc(1rem+1px)] left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
                  style={{ background: STEP_COLORS[i], boxShadow: `0 0 8px ${STEP_COLORS[i]}` }} />
              </div>
              <div className="md:text-center mt-2">
                <div className="text-sm font-semibold text-ink">{s.title}</div>
                <div className="text-xs text-ink-faint mt-1 leading-relaxed">{s.desc}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Benchmark section ──────────────────────────────────────── */
function BenchSection ({ inView }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Bar chart */}
      <div className="relative rounded-2xl overflow-hidden p-px"
        style={{ background: 'linear-gradient(135deg, rgba(41,48,73,0.8) 0%, transparent 70%)' }}>
        <div className="rounded-2xl p-6 sm:p-8 space-y-5"
          style={{ background: 'linear-gradient(135deg, #141820 0%, #0f1217 100%)' }}>
          <div className="text-xs text-ink-faint uppercase tracking-widest font-semibold mb-6">Execution time — 2M rows</div>
          <BenchBar label="Single machine" ms={5958} max={6200}
            color="linear-gradient(90deg,#ef4444,#f87171)" inView={inView} />
          <BenchBar label="QueryForge · 3 workers" ms={3512} max={6200}
            color="linear-gradient(90deg,#3b82f6,#60a5fa)" inView={inView} />
          <div className="pt-4 border-t border-border/60 text-xs text-ink-ghost">
            Lower is better · milliseconds
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { val: '1.70×', label: 'Speedup', sub: 'vs single machine', color: '#10b981' },
          { val: '570K',  label: 'Rows/sec', sub: 'peak throughput',  color: '#3b82f6' },
          { val: '5M',    label: 'Max rows', sub: 'tested & verified', color: '#818cf8' },
          { val: '3',     label: 'Workers',  sub: 'parallel nodes',   color: '#f59e0b' },
        ].map((s, i) => {
          const [ref, vis] = useInView(0.1)
          return (
            <div key={i} ref={ref}
              className="relative rounded-xl overflow-hidden p-px"
              style={{
                background: `linear-gradient(135deg, ${s.color}30 0%, transparent 70%)`,
                opacity: vis ? 1 : 0,
                transform: vis ? 'scale(1)' : 'scale(0.95)',
                transition: `opacity 0.4s ease ${i*80}ms, transform 0.4s cubic-bezier(0.16,1,0.3,1) ${i*80}ms`,
              }}>
              <div className="rounded-xl px-4 py-4 h-full"
                style={{ background: 'linear-gradient(135deg, #141820 0%, #0f1217 100%)' }}>
                <div className="text-3xl font-bold font-mono tabular-nums" style={{ color: s.color }}>{s.val}</div>
                <div className="text-xs font-semibold text-ink mt-1">{s.label}</div>
                <div className="text-[10px] text-ink-faint mt-0.5">{s.sub}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Tech grid ──────────────────────────────────────────────── */
const TECH_ICONS = {
  'Node.js':      '#68a063', 'gRPC':        '#244c5a', 'PostgreSQL': '#336791',
  'MinIO':        '#c72c48', 'React':       '#61dafb', 'WebSocket':  '#3b82f6',
  'Prometheus':   '#e6522c', 'Grafana':     '#f46800', 'OpenTelemetry': '#425cc7',
  'Docker':       '#2496ed',
}

function TechGrid () {
  const [ref, vis] = useInView(0.1)
  return (
    <div ref={ref} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {TECH.map((t, i) => (
        <div key={i}
          className="relative rounded-xl overflow-hidden p-px group"
          style={{
            background: `linear-gradient(135deg, ${TECH_ICONS[t.name] || '#293049'}30 0%, transparent 70%)`,
            opacity: vis ? 1 : 0,
            transform: vis ? 'translateY(0)' : 'translateY(12px)',
            transition: `opacity 0.4s ease ${i*40}ms, transform 0.4s cubic-bezier(0.16,1,0.3,1) ${i*40}ms`,
          }}>
          <div className="rounded-xl px-4 py-4 h-full group-hover:bg-card transition-colors"
            style={{ background: 'linear-gradient(135deg, #141820 0%, #0f1217 100%)' }}>
            {/* Color dot */}
            <div className="w-2.5 h-2.5 rounded-full mb-3"
              style={{ background: TECH_ICONS[t.name] || '#293049', boxShadow: `0 0 8px ${TECH_ICONS[t.name] || '#293049'}80` }} />
            <div className="text-xs font-semibold text-ink">{t.name}</div>
            <div className="text-[10px] text-ink-faint mt-0.5">{t.role}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── Feature card ───────────────────────────────────────────── */
function FeatureCard ({ icon, title, desc, badge, delay }) {
  const [ref, vis] = useInView(0.1)
  const BADGE_MAP = {
    Performance: '#3b82f6', Architecture: '#10b981', Reliability: '#f59e0b',
    'Real-time': '#818cf8', Observability: '#e879f9', Monitoring: '#34d399',
  }
  const c = BADGE_MAP[badge] || '#8892a4'
  return (
    <div ref={ref}
      className="relative rounded-2xl overflow-hidden p-px group cursor-default"
      style={{
        background: `linear-gradient(135deg, ${c}20 0%, transparent 60%)`,
        opacity: vis ? 1 : 0,
        transform: vis ? 'translateY(0)' : 'translateY(16px)',
        transition: `opacity 0.4s ease ${delay}ms, transform 0.4s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}>
      <div className="rounded-2xl p-5 h-full flex flex-col gap-4 group-hover:bg-card transition-colors duration-200"
        style={{ background: 'linear-gradient(135deg, #141820 0%, #0f1217 100%)' }}>
        <div aria-hidden className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${c}08 0%, transparent 70%)` }} />
        <div className="flex items-start justify-between relative">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `${c}12`, border: `1px solid ${c}22` }}>
            {icon}
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: `${c}12`, border: `1px solid ${c}22`, color: c }}>
            {badge}
          </span>
        </div>
        <div className="relative">
          <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
          <p className="text-xs text-ink-faint leading-relaxed">{desc}</p>
        </div>
      </div>
    </div>
  )
}

/* ─── Step card ──────────────────────────────────────────────── */
function StepCard ({ step, title, desc, delay }) {
  const [ref, vis] = useInView(0.1)
  return (
    <div
      ref={ref}
      className="flex gap-5"
      style={{
        opacity:    vis ? 1 : 0,
        transform:  vis ? 'translateX(0)' : 'translateX(-16px)',
        transition: `opacity 0.4s ease ${delay}ms, transform 0.4s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}
    >
      {/* Step bubble */}
      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center font-mono text-xs font-bold text-accent">
        {step}
      </div>
      <div className="card flex-1 px-5 py-4">
        <h3 className="text-sm font-semibold text-ink mb-1">{title}</h3>
        <p className="text-xs text-ink-faint leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}
