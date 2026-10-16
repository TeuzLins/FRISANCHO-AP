import { Component, Injectable, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Activity, ArrowRight, BookOpen, Calculator, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Download, FileText, Info, LogOut, Menu, Plus, RotateCcw, Search, Settings, ShieldCheck, Users, X, AlertTriangle, Pencil, Trash2, LoaderCircle } from 'lucide-angular';
import { type CalculationInput, type CalculationResult } from '@frisancho/anthropometry';
import { api, ApiError, setCsrfToken } from './api';
export const Icons = LucideAngularModule;
export const iconProviders = LucideAngularModule.pick({ Activity, ArrowRight, BookOpen, Calculator, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Download, FileText, Info, LogOut, Menu, Plus, RotateCcw, Search, Settings, ShieldCheck, Users, X, AlertTriangle, Pencil, Trash2, LoaderCircle });
export type User = { id: string; name: string; email: string };
export type Patient = { id: string; identifier: string; displayName: string; birthDate: string | null; referenceSex: 'male' | 'female' | null; archivedAt?: string | null; _count?: { assessments: number } };
export type Assessment = { id: string; patientId: string; patient: Patient; evaluationDate: string; ageYears: number; inputs: CalculationInput; result: CalculationResult; revision: number };
export type List<T> = { items: T[]; total: number; page: number; limit: number };
export type AuthResponse = { user: User; csrfToken: string };
@Injectable({ providedIn: 'root' })
export class SessionService {
  user = signal<User | null>(null); loading = signal(true); authOpen = signal(false); notice = signal(''); dataVersion = signal(0);
  constructor() { api<AuthResponse>('/auth/me').then(s => this.accept(s)).catch(e => { if (!(e instanceof ApiError && e.status === 401)) this.notice.set('O cálculo está disponível. Para acessar dados salvos, confira a conexão com o banco.'); }).finally(() => this.loading.set(false)); }
  accept(s: AuthResponse) { this.user.set(s.user); setCsrfToken(s.csrfToken); this.authOpen.set(false); }
  async logout() { try { await api('/auth/logout', { method: 'POST' }); this.clear(); } catch (e) { this.notice.set((e as Error).message); } }
  clear() { this.user.set(null); setCsrfToken(''); this.dataVersion.update(n => n + 1); }
}
@Component({ selector: 'app-error', standalone: true, imports: [Icons], template: `@if (message) { <div class="error-box" role="alert"><lucide-icon name="alert-triangle" [size]="18"/><span>{{ message }}</span></div> }` })
export class ErrorComponent { @Input() message = ''; }
@Component({ selector: 'app-modal', standalone: true, imports: [Icons], template: `<dialog #dialog [class.wide]="wide" class="modal" (cancel)="cancel($event)" aria-labelledby="modal-title"><div class="modal-heading"><h2 id="modal-title">{{title}}</h2><button class="icon-button" type="button" aria-label="Fechar" (click)="closed.emit()"><lucide-icon name="x" [size]="20"/></button></div><ng-content/></dialog>` })
export class ModalComponent implements AfterViewInit, OnDestroy {
  @Input() title = ''; @Input() wide = false; @Output() closed = new EventEmitter<void>(); @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  previous: HTMLElement | null = null;
  ngAfterViewInit() { this.previous = document.activeElement as HTMLElement; this.dialog.nativeElement.showModal(); }
  ngOnDestroy() { this.dialog.nativeElement.close(); this.previous?.focus(); }
  cancel(event: Event) { event.preventDefault(); this.closed.emit(); }
}
@Component({ selector: 'app-pager', standalone: true, imports: [Icons], template: `<div class="pager"><span>{{ total }} registros · Página {{page}} de {{pages}}</span><div><button class="icon-button" aria-label="Página anterior" [disabled]="page <= 1" (click)="change.emit(page - 1)"><lucide-icon name="chevron-left" [size]="18"/></button><button class="icon-button" aria-label="Próxima página" [disabled]="page * limit >= total" (click)="change.emit(page + 1)"><lucide-icon name="chevron-right" [size]="18"/></button></div></div>` })
export class PagerComponent { @Input() page = 1; @Input() total = 0; @Input() limit = 10; @Output() change = new EventEmitter<number>(); get pages() { return Math.max(1, Math.ceil(this.total / this.limit)); } }
@Component({ selector: 'app-gate', standalone: true, imports: [CommonModule, Icons], template: `<div class="card empty"><lucide-icon name="shield-check" [size]="38"/><h2>Entre na conta para acessar {{noun}}</h2><p>Os registros salvos pertencem ao usuário autenticado.</p><button class="button" (click)="login.emit()">Entrar na conta <lucide-icon name="arrow-right" [size]="17"/></button></div>` })
export class GateComponent { @Input() noun = 'seus dados'; @Output() login = new EventEmitter<void>(); }
