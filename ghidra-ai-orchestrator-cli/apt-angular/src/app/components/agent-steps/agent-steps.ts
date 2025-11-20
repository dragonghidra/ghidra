import { AfterViewInit, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { NgClass, NgFor } from '@angular/common';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

type StepMetric = {
  label: string;
  value: string;
  accentClass: string;
};

type AgentStep = {
  id: string;
  badge: string;
  title: string;
  headline: string;
  details: string[];
  metrics: StepMetric[];
};

@Component({
  selector: 'app-agent-steps',
  imports: [NgFor, NgClass],
  templateUrl: './agent-steps.html',
  styleUrl: './agent-steps.css',
})
export class AgentSteps implements AfterViewInit {
  protected readonly steps: AgentStep[] = [
    {
      id: '01',
      badge: 'Perception Mesh',
      title: 'Sense & Normalize',
      headline: 'Signals snap into a single stream.',
      details: ['12 sensor planes', '47 ms latency', 'Adaptive RAG windows'],
      metrics: [
        { label: 'Signal Fidelity', value: '98.3%', accentClass: 'text-agent-cyan' },
        { label: 'Vectors/sec', value: '1.2M', accentClass: 'text-agent-emerald' },
      ],
    },
    {
      id: '02',
      badge: 'Cognition Engine',
      title: 'Reason & Forecast',
      headline: 'Inference locks onto the best tool path.',
      details: ['Self-evaluating prompts', 'Policy guardrails', 'Tool arbitration'],
      metrics: [
        { label: 'Plan Horizon', value: '12 steps', accentClass: 'text-agent-violet' },
        { label: 'Win Probability', value: '92%', accentClass: 'text-agent-fuchsia' },
      ],
    },
    {
      id: '03',
      badge: 'Action Fabric',
      title: 'Execute & Adapt',
      headline: 'Parallel actuators stay synced through streaming state.',
      details: ['Detached sub-agents', 'Live guardrails', 'Temporal diffing'],
      metrics: [
        { label: 'Throughput', value: '324 ops/s', accentClass: 'text-agent-cyan' },
        { label: 'Rollback Risk', value: '0.6%', accentClass: 'text-agent-emerald' },
      ],
    },
    {
      id: '04',
      badge: 'Intelligence Cloud',
      title: 'Learn & Broadcast',
      headline: 'Every run updates the shared memory core.',
      details: ['Realtime diffusions', 'Human-in-the-loop review', 'Edge deployment'],
      metrics: [
        { label: 'Knowledge Delta', value: '+4.2%', accentClass: 'text-agent-fuchsia' },
        { label: 'Release Cadence', value: 'Daily', accentClass: 'text-agent-violet' },
      ],
    },
  ];

  protected readonly activeStep = signal(0);
  protected readonly scrollProgress = signal(0);
  protected readonly scrollPercent = computed(() => Math.round(this.scrollProgress() * 100));
  protected readonly currentStep = computed(() => this.steps[this.activeStep()] ?? this.steps[0]);

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const nativeElement = this.elementRef.nativeElement;
    const stage = nativeElement.querySelector('.scroll-stage');
    if (!(stage instanceof HTMLElement)) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.registerPlugin(ScrollTrigger);

      const layers = Array.from(stage.querySelectorAll('.step-layer')).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      if (!layers.length) {
        return;
      }

      gsap.set(layers, { autoAlpha: 0, scale: 0.9, yPercent: 6, filter: 'blur(14px)' });

      const timeline = gsap.timeline({
        defaults: { ease: 'power2.out' },
        scrollTrigger: {
          trigger: stage,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const clampedProgress = Math.min(1, Math.max(0, self.progress));
            this.scrollProgress.set(clampedProgress);
            const index = Math.min(layers.length - 1, Math.round(clampedProgress * (layers.length - 1)));
            this.activeStep.set(index);
          },
        },
      });

      layers.forEach((layer, index) => {
        const enterPoint = index * 1.2;
        timeline
          .to(
            layer,
            {
              autoAlpha: 1,
              scale: 1,
              yPercent: 0,
              filter: 'blur(0px)',
              duration: 0.9,
            },
            enterPoint,
          )
          .to(
            layer,
            {
              autoAlpha: 0,
              scale: 1.05,
              yPercent: -8,
              filter: 'blur(12px)',
              duration: 0.8,
            },
            enterPoint + 0.8,
          );
      });
    }, nativeElement);

    this.destroyRef.onDestroy(() => ctx.revert());
  }
}
