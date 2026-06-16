
import { InputFiles, Phase1Settings, Phase2Settings, Phase3Settings } from '../../types';

/**
 * 定义与 Copilot 相关的类型
 */

export interface BrandConfig {
  url: string;
  audience: string;
  tone: string;
  description: string;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
}

export interface CopilotContext {
  brand: BrandConfig;
  inputs: InputFiles;
  p1Settings: Phase1Settings;
  p2Settings: Phase2Settings;
  p3Settings?: Phase3Settings;
  activePhase: 0 | 1 | 2 | 3;
  timestamp: number;
}
