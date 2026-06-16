import { Phase3Settings, ImageSize } from '../../types';

export const defaultPhase3Settings = (): Phase3Settings => ({
  inspirationImage: undefined,
  styleDNA: '',
  dnaTranslation: undefined,
  intensity: 0.8,
  grain: true,
  contrast: 'Standard',
  imageSize: ImageSize.K2,
  remark: '',
});
