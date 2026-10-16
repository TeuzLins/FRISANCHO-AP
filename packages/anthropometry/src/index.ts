import { z } from 'zod';

export const ENGINE_VERSION = 'cmb-1.0.0';
const positive = z.number().finite().positive();
export const calculationSchema = z.object({
  ageYears: z.number().int().min(0),
  referenceSex: z.enum(['female', 'male']).nullable().default(null),
  armCircumferenceCm: positive,
  tricepsSkinfoldMm: positive,
  reportedMuscleCircumferenceCm: positive.nullable().optional(),
  weightKg: positive.nullable().optional(),
  heightCm: positive.nullable().optional(),
  referenceId: z.string().min(1).max(80).default('frisancho-1981'),
}).strict().refine(x => x.armCircumferenceCm - Math.PI * x.tricepsSkinfoldMm / 10 > 0, {
  message: 'As medidas devem produzir uma CMB maior que zero. Confira CB e DCT.', path: ['tricepsSkinfoldMm'],
});
export type CalculationInput = z.infer<typeof calculationSchema>;
export interface ReferenceMetadata {
  id: string; version: string; author: string; title: string; year: number; doi: string; url: string;
  population: string; ageRange: { min: number; max: number }; sexes: readonly string[];
  indicator: string; unit: string; availablePercentiles: readonly number[]; dataProvenance: string;
  validationStatus: 'metadata-only' | 'validated'; dataAvailable: boolean;
}
export const reference: ReferenceMetadata = {
  id: 'frisancho-1981', version: 'metadata-1.0.0', author: 'A. Roberto Frisancho',
  title: 'New norms of upper limb fat and muscle areas for assessment of nutritional status',
  year: 1981, doi: '10.1093/ajcn/34.11.2540', url: 'https://pubmed.ncbi.nlm.nih.gov/6975564/',
  population: '19.097 participantes brancos dos Estados Unidos; levantamento HANES 1971–1974.',
  ageRange: { min: 1, max: 74 }, sexes: ['female', 'male'],
  indicator: 'Medidas de gordura e músculo do braço; nenhuma tabela numérica incorporada para CMB.',
  unit: 'cm', availablePercentiles: [], dataProvenance: 'Metadados bibliográficos; sem dados tabulados licenciados.',
  validationStatus: 'metadata-only', dataAvailable: false,
};
export type UnavailableReason = { code: string; message: string };
export interface ReferenceInterpretation { percentile: number | null; classification: string | null; warnings: UnavailableReason[] }
export interface ReferenceProvider {
  metadata: ReferenceMetadata;
  // A future verified/licensed dataset supplies its documented protocol here.
  // This hook is called only after coverage, sex and validation checks pass.
  interpret?: (cmbCm: number, input: CalculationInput) => ReferenceInterpretation;
}
export const referenceProviders: readonly ReferenceProvider[] = [{ metadata: reference }];
export function referenceReasons(input: CalculationInput, provider: ReferenceProvider): UnavailableReason[] {
  const r = provider.metadata; const reasons: UnavailableReason[] = [];
  if (!r.dataAvailable || r.validationStatus !== 'validated') reasons.push({ code: 'REFERENCE_DATA_UNAVAILABLE', message: 'Os dados tabulados desta referência não estão carregados e validados.' });
  if (input.ageYears < r.ageRange.min || input.ageYears > r.ageRange.max) reasons.push({ code: 'AGE_OUTSIDE_REFERENCE_RANGE', message: `A idade está fora da cobertura de ${r.ageRange.min} a ${r.ageRange.max} anos de ${r.author.includes('Frisancho') ? 'Frisancho' : r.author} ${r.year}.` });
  if (r.sexes.length && !input.referenceSex) reasons.push({ code: 'REFERENCE_SEX_REQUIRED', message: 'O sexo utilizado pela tabela de referência não foi informado.' });
  else if (input.referenceSex && r.sexes.length && !r.sexes.includes(input.referenceSex)) reasons.push({ code: 'REFERENCE_SEX_UNSUPPORTED', message: 'A categoria de sexo não é coberta por esta referência.' });
  if (r.dataAvailable && r.validationStatus === 'validated' && !provider.interpret) reasons.push({ code: 'REFERENCE_PROTOCOL_UNAVAILABLE', message: 'O protocolo de interpretação desta referência não foi implementado e validado.' });
  return reasons;
}
export function calculate(raw: unknown) {
  const input = calculationSchema.parse(raw);
  const provider = referenceProviders.find(p => p.metadata.id === input.referenceId);
  if (!provider) throw new z.ZodError([{ code: 'custom', path: ['referenceId'], message: 'Selecione uma referência disponível.' }]);
  const selectedReference = provider.metadata;
  const tricepsSkinfoldCm = input.tricepsSkinfoldMm / 10;
  const muscleCircumferenceCm = input.armCircumferenceCm - Math.PI * tricepsSkinfoldCm;
  const reasons = referenceReasons(input, provider);
  const interpretation = reasons.length === 0 && provider.interpret ? provider.interpret(muscleCircumferenceCm, input) : { percentile: null, classification: null, warnings: [] };
  return {
    input, muscleCircumferenceCm, tricepsSkinfoldCm, unit: 'cm',
    displayValue: formatNumber(muscleCircumferenceCm), rounding: 'Duas casas decimais somente na apresentação; precisão completa no armazenamento.',
    reportedDifferenceCm: input.reportedMuscleCircumferenceCm == null ? null : input.reportedMuscleCircumferenceCm - muscleCircumferenceCm,
    bmi: input.weightKg && input.heightCm ? input.weightKg / (input.heightCm / 100) ** 2 : null,
    engineVersion: ENGINE_VERSION, reference: selectedReference, percentile: interpretation.percentile, classification: interpretation.classification,
    warnings: [...reasons, ...interpretation.warnings], classificationUnavailableReasons: reasons,
  };
}
export type CalculationResult = ReturnType<typeof calculate>;
export function formatNumber(n: number) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function parseDecimal(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(normalized)) return NaN;
  return Number(normalized.replace(',', '.'));
}
export function ageOnDate(birth: string, evaluation: string) {
  const b = z.iso.date().parse(birth); const e = z.iso.date().parse(evaluation);
  if (b > e) throw new Error('A data de nascimento não pode ser posterior à avaliação.');
  let age = Number(e.slice(0, 4)) - Number(b.slice(0, 4));
  if (e.slice(5) < b.slice(5)) age--;
  return age;
}
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
