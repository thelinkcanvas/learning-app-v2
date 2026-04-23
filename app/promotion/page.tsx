'use client';

import Link from 'next/link';
import { HeroSection } from '@/components/promotion/HeroSection';
import { OverviewSection } from '@/components/promotion/OverviewSection';
import { FeaturesSection } from '@/components/promotion/FeaturesSection';
import { TechStackSection } from '@/components/promotion/TechStackSection';
import { MetricsSection } from '@/components/promotion/MetricsSection';
import { LearningSection } from '@/components/promotion/LearningSection';
import { CTASection } from '@/components/promotion/CTASection';

export default function PromotionPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Header Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-blue-600">
            📚 Learning App V2
          </Link>
          <div className="flex gap-6">
            <Link href="/" className="text-gray-600 hover:text-blue-600 font-medium transition">
              Home
            </Link>
            <a href="#features" className="text-gray-600 hover:text-blue-600 font-medium transition">
              Features
            </a>
            <a href="#tech" className="text-gray-600 hover:text-blue-600 font-medium transition">
              Tech Stack
            </a>
          </div>
        </div>
      </nav>

      {/* Sections */}
      <HeroSection />
      <OverviewSection />
      <FeaturesSection />
      <TechStackSection />
      <MetricsSection />
      <LearningSection />
      <CTASection />

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-gray-400">
            Learning App V2 © 2026. Designed for thoughtful learning.
          </p>
        </div>
      </footer>
    </main>
  );
}
