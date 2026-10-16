import { describe, expect, it } from 'vitest';
import { calculate, parseDecimal, ageOnDate } from '../packages/anthropometry/src/index.js';
const example = { ageYears: 76, referenceSex: null, armCircumferenceCm: 30, tricepsSkinfoldMm: 16, reportedMuscleCircumferenceCm: 25 };
describe('Motor antropométrico', () => {
  it('converte mm, mantém precisão e arredonda apenas a apresentação', () => { const r = calculate(example); expect(r.muscleCircumferenceCm).toBeCloseTo(24.97345175425633, 12); expect(r.tricepsSkinfoldCm).toBe(1.6); expect(r.displayValue).toBe('24,97'); expect(r.reportedDifferenceCm).toBeCloseTo(0.02654824574367, 12); expect(r.input.reportedMuscleCircumferenceCm).toBe(25); });
  it('mantém classificação null e todos os motivos independentes para 76 anos', () => { const r = calculate(example); expect(r.classification).toBeNull(); expect(r.percentile).toBeNull(); expect(r.classificationUnavailableReasons.map(x => x.code)).toEqual(['REFERENCE_DATA_UNAVAILABLE', 'AGE_OUTSIDE_REFERENCE_RANGE', 'REFERENCE_SEX_REQUIRED']); });
  it.each([1, 74])('aceita a fronteira %i da cobertura, sem simular uma tabela carregada', ageYears => { const r = calculate({ ...example, ageYears, referenceSex: 'female' }); expect(r.classificationUnavailableReasons.map(x => x.code)).toEqual(['REFERENCE_DATA_UNAVAILABLE']); });
  it.each([0, 75, 120])('não extrapola a referência para idade %i e continua calculando', ageYears => { const r = calculate({ ...example, ageYears }); expect(r.classificationUnavailableReasons.some(x => x.code === 'AGE_OUTSIDE_REFERENCE_RANGE')).toBe(true); expect(r.muscleCircumferenceCm).toBeGreaterThan(0); });
  it.each([0, -1, NaN, Infinity, -Infinity, undefined, '30'])('rejeita CB inválida: %s', armCircumferenceCm => expect(() => calculate({ ...example, armCircumferenceCm })).toThrow());
  it.each([0, -1, NaN, Infinity, undefined])('rejeita DCT inválida: %s', tricepsSkinfoldMm => expect(() => calculate({ ...example, tricepsSkinfoldMm })).toThrow());
  it('rejeita CMB não positiva', () => expect(() => calculate({ ...example, armCircumferenceCm: 2 })).toThrow());
  it('não aceita dados pessoais no cálculo rápido', () => expect(() => calculate({ ...example, patientId: 'paciente' })).toThrow());
  it('calcula apenas IMC numérico com peso e altura medidos', () => { expect(calculate({ ...example, weightKg: 72, heightCm: 180 }).bmi).toBeCloseTo(22.22222); expect(calculate({ ...example, weightKg: 72 }).bmi).toBeNull(); });
  it.each([['16,5', 16.5], ['16.5', 16.5], [' 16,5 ', 16.5], [',5', .5], ['', undefined], [' ', undefined]])('normaliza %s sem transformar vazio em zero', (value, expected) => expect(parseDecimal(value as string)).toBe(expected));
  it.each(['1.000,5', '1,000.5', 'Infinity', 'NaN', '16mm', '1e3', '-16', '16,'])('rejeita decimal ambíguo %s', value => expect(parseDecimal(value)).toBeNaN());
  it('considera aniversário e data histórica', () => { expect(ageOnDate('1950-10-09', '2026-10-08')).toBe(75); expect(ageOnDate('1950-10-09', '2026-10-09')).toBe(76); expect(ageOnDate('1950-10-09', '2020-01-01')).toBe(69); expect(() => ageOnDate('2050-01-01', '2026-10-08')).toThrow(); expect(() => ageOnDate('2000-02-31', '2026-10-08')).toThrow(); });
});
