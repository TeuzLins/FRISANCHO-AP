import { Component, Injectable, inject, signal, effect, OnDestroy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { calculationSchema, parseDecimal, formatNumber, localDate, ageOnDate, type CalculationInput, type CalculationResult } from '@frisancho/anthropometry';
import { Icons, ErrorComponent, SessionService, type Patient, type Assessment, type List } from './shared';
import { api, ApiError } from './api';
import { PageHeaderComponent, MeasurementFieldComponent, ResultPanelComponent } from './presentation';
const defaults = () => ({ age: '', sex: '', cb: '', dct: '', reported: '', weight: '', height: '', date: localDate(), patientId: '' });
type Fields = ReturnType<typeof defaults>;
@Injectable({ providedIn: 'root' })
export class EvaluationStore {
  session = inject(SessionService); ownerId: string | null = null;
  form = inject(NonNullableFormBuilder).group(defaults());
  result = signal<CalculationResult | null>(null); editing = signal<Assessment | null>(null); error = signal('');
  generation = 0; idempotencyKey: string = crypto.randomUUID();
  constructor() { this.form.valueChanges.subscribe(() => { this.generation++; this.idempotencyKey = crypto.randomUUID(); this.result.set(null); this.error.set(''); }); }
  reset() { this.ownerId = null; this.editing.set(null); this.form.reset(defaults()); this.result.set(null); }
  edit(a: Assessment) {
    this.ownerId = this.session.user()?.id || null;
    const i = a.inputs;
    this.editing.set(a); this.form.reset({ age: String(i.ageYears), sex: i.referenceSex || '', cb: String(i.armCircumferenceCm), dct: String(i.tricepsSkinfoldMm), reported: i.reportedMuscleCircumferenceCm == null ? '' : String(i.reportedMuscleCircumferenceCm), weight: i.weightKg == null ? '' : String(i.weightKg), height: i.heightCm == null ? '' : String(i.heightCm), date: a.evaluationDate, patientId: a.patientId }); this.result.set(null);
  }
}
@Component({ selector: 'app-evaluation', standalone: true, imports: [ReactiveFormsModule, Icons, ErrorComponent, PageHeaderComponent, MeasurementFieldComponent, ResultPanelComponent], templateUrl: './evaluation.html' })
export class EvaluationComponent implements OnDestroy {
  session = inject(SessionService); store = inject(EvaluationStore); router = inject(Router);
  form = this.store.form; result = this.store.result; busy = signal(false); saving = signal(false); fieldErrors = signal<Partial<Record<keyof Fields, string>>>({});
  patients = signal<Patient[]>([]); patientSearch = signal(''); patientError = signal(''); format = formatNumber;
  selectedBirthDate = signal<string | null>(null);
  numericFields = [{ name: 'cb' as const, title: 'Circunferência do braço — CB', unit: 'cm', placeholder: 'Ex.: 30', hint: 'Circunferência medida em centímetros.' }, { name: 'dct' as const, title: 'Dobra cutânea tricipital — DCT', unit: 'mm', placeholder: 'Ex.: 16', hint: 'Espessura medida em milímetros.' }];
  optionalFields = [{ name: 'reported' as const, title: 'CMB informada anteriormente', unit: 'cm', placeholder: 'Ex.: 25' }, { name: 'weight' as const, title: 'Peso medido', unit: 'kg', placeholder: 'Ex.: 70' }, { name: 'height' as const, title: 'Altura medida', unit: 'cm', placeholder: 'Ex.: 170' }];
  hasComplementaryError() { const errors = this.fieldErrors(); return !!(errors.reported || errors.weight || errors.height); }
  private request = 0;
  subscription = this.form.controls.date.valueChanges.subscribe(() => this.deriveAge());
  constructor() {
    effect(() => {
      const user = this.session.user(); this.session.dataVersion(); const q = this.patientSearch();
      if (!user) { this.patients.set([]); return; }
      const request = ++this.request;
      api<List<Patient>>(`/patients?limit=100&q=${encodeURIComponent(q)}`).then(list => {
        if (request !== this.request) return;
        const selected = list.items.find(p => p.id === this.form.controls.patientId.value) || this.patients().find(p => p.id === this.form.controls.patientId.value) || this.store.editing()?.patient;
        this.patients.set(selected && !list.items.some(p => p.id === selected.id) ? [selected, ...list.items] : list.items);
        this.selectedBirthDate.set(selected?.birthDate || null); this.patientError.set(''); this.deriveAge();
      }).catch(e => { if (request === this.request) this.patientError.set((e as Error).message); });
    });
  }
  ngOnDestroy() { this.subscription.unsubscribe(); this.request++; }
  deriveAge() {
    const birth = this.selectedBirthDate(); const date = this.form.controls.date.value;
    if (birth && date) try { const age = String(ageOnDate(birth, date)); if (this.form.controls.age.value !== age) this.form.controls.age.setValue(age); this.fieldErrors.update(e => ({ ...e, date: '' })); } catch (e) { this.fieldErrors.update(errors => ({ ...errors, date: (e as Error).message })); }
  }
  choosePatient(event: Event) {
    if (!this.store.editing()) this.store.ownerId = this.session.user()?.id || null;
    const id = (event.target as HTMLSelectElement).value; const patient = this.patients().find(p => p.id === id);
    this.selectedBirthDate.set(patient?.birthDate || null);
    if (patient) this.form.controls.sex.setValue(patient.referenceSex || '');
    this.deriveAge();
  }
  input(v: Fields): CalculationInput { return { ageYears: parseDecimal(v.age) as number, referenceSex: v.sex === 'male' || v.sex === 'female' ? v.sex : null, armCircumferenceCm: parseDecimal(v.cb) as number, tricepsSkinfoldMm: parseDecimal(v.dct) as number, reportedMuscleCircumferenceCm: parseDecimal(v.reported) ?? null, weightKg: parseDecimal(v.weight) ?? null, heightCm: parseDecimal(v.height) ?? null, referenceId: 'frisancho-1981' }; }
  async calculate() {
    if (this.busy() || this.saving()) return;
    const values = this.form.getRawValue(); const data = calculationSchema.safeParse(this.input(values));
    const names: Record<string, keyof Fields> = { ageYears: 'age', armCircumferenceCm: 'cb', tricepsSkinfoldMm: 'dct', reportedMuscleCircumferenceCm: 'reported', weightKg: 'weight', heightCm: 'height' };
    const labels: Record<string, string> = { age: 'Informe a idade em anos completos, como inteiro não negativo.', cb: 'Informe a circunferência do braço em centímetros, maior que zero.', dct: 'Informe a dobra tricipital em milímetros, maior que zero.', reported: 'Informe uma CMB anterior positiva ou deixe vazio.', weight: 'Informe um peso medido positivo ou deixe vazio.', height: 'Informe uma altura medida positiva ou deixe vazio.' };
    const errors: Partial<Record<keyof Fields, string>> = {};
    if (!data.success) for (const issue of data.error.issues) { const field = names[String(issue.path[0])] || 'cb'; errors[field] = issue.message.includes('CMB maior') ? issue.message : labels[field]; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) errors.date = 'Informe uma data válida.';
    if (this.selectedBirthDate()) try { ageOnDate(this.selectedBirthDate()!, values.date); } catch (e) { errors.date = (e as Error).message; }
    this.fieldErrors.set(errors);
    if (!data.success || Object.keys(errors).length) { this.result.set(null); document.getElementById(Object.keys(errors)[0])?.focus(); return; }
    const generation = this.store.generation; this.busy.set(true); this.store.error.set('');
    try { const result = await api<CalculationResult>('/calculations/cmb', { method: 'POST', body: JSON.stringify(data.data) }); if (generation === this.store.generation) this.result.set(result); }
    catch (e) { if (generation === this.store.generation) this.store.error.set((e as Error).message); } finally { this.busy.set(false); }
  }
  loadExample() { this.store.reset(); this.selectedBirthDate.set(null); this.form.patchValue({ age: '76', cb: '30', dct: '16', reported: '25' }); this.fieldErrors.set({}); }
  clear() { this.store.reset(); this.selectedBirthDate.set(null); this.fieldErrors.set({}); }
  async save() {
    if (this.busy() || this.saving()) return;
    if (!this.session.user()) { this.session.authOpen.set(true); return; }
    if (this.store.ownerId && this.store.ownerId !== this.session.user()!.id) { this.store.error.set('Esta avaliação foi iniciada em outra conta. Entre na conta original ou limpe o formulário para iniciar um novo registro.'); return; }
    this.store.ownerId = this.session.user()!.id;
    const result = this.result(); if (!result) return;
    const v = this.form.getRawValue();
    if (!v.patientId) { this.store.error.set('Selecione um paciente antes de salvar. Cadastre-o na página Pacientes, se necessário.'); document.getElementById('patientId')?.focus(); return; }
    const edit = this.store.editing(); this.saving.set(true); this.store.error.set('');
    try { await api(edit ? `/assessments/${edit.id}` : '/assessments', { method: edit ? 'PATCH' : 'POST', headers: { 'Idempotency-Key': this.store.idempotencyKey }, body: JSON.stringify({ patientId: v.patientId, evaluationDate: v.date, inputs: result.input, ...(edit ? { revision: edit.revision } : {}) }) }); this.clear(); this.session.dataVersion.update(n => n + 1); await this.router.navigateByUrl('/historico'); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.session.clear(); this.session.authOpen.set(true); }
      this.store.error.set((e as Error).message);
    } finally { this.saving.set(false); }
  }
}
