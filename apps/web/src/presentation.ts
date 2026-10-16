import { Component, Input, Output, EventEmitter } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { formatNumber, reference, type CalculationResult, type ReferenceMetadata, type UnavailableReason } from '@frisancho/anthropometry';
import { Icons } from './shared';

@Component({ selector: 'app-page-header', standalone: true, template: `<div class="page-intro"><div class="page-intro-copy"><h1>{{title}}</h1><p>{{description}}</p></div><div class="page-intro-actions"><ng-content/></div></div>` })
export class PageHeaderComponent { @Input({ required: true }) title = ''; @Input() description = ''; }

@Component({ selector: 'app-measurement-field', standalone: true, imports: [ReactiveFormsModule], template: `
<label class="field" [for]="name"><span class="field-label">{{label}}</span><span class="unit-input" [class.invalid]="error"><input [id]="name" [formControl]="control" [attr.inputmode]="inputMode" autocomplete="off" [placeholder]="placeholder" [readOnly]="readOnly" [attr.aria-invalid]="!!error" [attr.aria-describedby]="name + '-hint ' + name + '-error'"/><span class="input-unit">{{unit}}</span></span>@if (hint) { <span class="field-hint" [id]="name + '-hint'">{{hint}}</span> }<span class="field-error" [id]="name + '-error'">{{error}}</span></label>` })
export class MeasurementFieldComponent {
  @Input({ required: true }) control!: FormControl<string>; @Input({ required: true }) name = ''; @Input({ required: true }) label = ''; @Input() unit = ''; @Input() placeholder = ''; @Input() hint = ''; @Input() error = ''; @Input() readOnly = false; @Input() inputMode = 'decimal';
}

@Component({ selector: 'app-reference-notice', standalone: true, imports: [Icons], template: `
<section class="card reference-status"><div class="reference-title"><lucide-icon name="book-open" [size]="20"/><h3>Referência e interpretação</h3></div><div class="reference-source"><span class="source-chip">{{metadata.author.includes('Frisancho') ? 'Frisancho' : metadata.author}} · {{metadata.year}}</span><span class="reference-availability">Sem tabela validada</span></div>
@if (reasons.length) { <div class="reference-warning"><h3 class="warning-title"><lucide-icon name="alert-triangle" [size]="18"/>Classificação indisponível para esta referência</h3><ul>@for (reason of reasons; track reason.code) { <li>{{reason.message}}</li> }</ul></div> } @else { <p>O cálculo da CMB está disponível. A classificação depende de uma tabela validada, compatível com idade e sexo.</p> }
<div class="reference-foot"><lucide-icon name="info" [size]="17"/><p>Não são apresentados percentis ou classificações sem uma referência validada.</p></div></section>` })
export class ReferenceNoticeComponent { @Input() metadata: ReferenceMetadata = reference; @Input() reasons: UnavailableReason[] = []; }

@Component({ selector: 'app-result-panel', standalone: true, imports: [Icons, ReferenceNoticeComponent], template: `
<section class="card result-card" [class.has-result]="result" aria-live="polite" aria-atomic="true"><div class="result-header"><span class="section-icon"><lucide-icon name="calculator" [size]="20"/></span><h2>Resultado</h2><span class="status-pill" [class.success]="result">{{result ? 'Calculado' : 'Aguardando'}}</span></div>
@if (result; as r) { <div class="result-value"><span class="result-label">CMB calculada</span><div><strong>{{r.displayValue}}</strong><b>cm</b></div><span>Circunferência Muscular do Braço</span></div><dl class="result-data"><div><dt>CB utilizada</dt><dd>{{format(r.input.armCircumferenceCm)}} cm</dd></div><div><dt>DCT utilizada</dt><dd>{{format(r.input.tricepsSkinfoldMm)}} mm</dd></div><div><dt>Idade na avaliação</dt><dd>{{r.input.ageYears}} anos</dd></div></dl>
@if (r.input.reportedMuscleCircumferenceCm != null) { <div class="comparison-note"><lucide-icon name="check" [size]="18"/><div><strong>{{format(r.input.reportedMuscleCircumferenceCm)}} cm informados / {{r.displayValue}} cm calculados</strong><p>Diferença: {{format(r.reportedDifferenceCm!)}} cm. O valor informado não substitui o cálculo.</p></div></div> }
@if (r.bmi != null) { <p class="bmi">IMC numérico: <strong>{{format(r.bmi)}} kg/m²</strong><br/><span class="field-hint">Sem classificação automática.</span></p> }
<details class="formula"><summary>Fórmula e conversão de unidades <lucide-icon name="chevron-down" [size]="17"/></summary><div class="formula-content"><p>DCT em cm = {{r.input.tricepsSkinfoldMm}} ÷ 10 = {{r.tricepsSkinfoldCm}}</p><p>CMB = {{r.input.armCircumferenceCm}} − π × {{r.tricepsSkinfoldCm}}</p><code>{{r.muscleCircumferenceCm}} cm</code><p>Sem arredondamento intermediário.</p></div></details>
} @else { <div class="result-empty"><div class="empty-result-icon"><lucide-icon name="calculator" [size]="28"/></div><p>Preencha as medidas para calcular a CMB.</p><span>O resultado será exibido aqui.</span></div> }
</section><app-reference-notice [metadata]="result?.reference || reference" [reasons]="result?.classificationUnavailableReasons || []"/>
@if (result) { <div class="result-actions"><button class="button save-button" [disabled]="saving || calculating" (click)="save.emit()"><lucide-icon [name]="saving ? 'loader-circle' : 'clipboard-list'" [class.spin]="saving" [size]="18"/>{{editing ? 'Salvar alterações' : 'Salvar avaliação'}}</button><p>{{authenticated ? 'O relatório fica disponível no histórico após salvar.' : 'Entre na conta para salvar e emitir o relatório.'}}</p></div> }
` })
export class ResultPanelComponent {
  @Input() result: CalculationResult | null = null; @Input() saving = false; @Input() calculating = false; @Input() editing = false; @Input() authenticated = false; @Output() save = new EventEmitter<void>(); format = formatNumber; reference = reference;
}
