import { Component, inject, signal, Output, EventEmitter, forwardRef } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { z } from 'zod';
import { Icons, ModalComponent, ErrorComponent, SessionService, type AuthResponse } from './shared';
import { api } from './api';
import { SidebarComponent, TopbarComponent, navigation } from './navigation';
@Component({ selector: 'app-root', standalone: true, imports: [RouterOutlet, Icons, SidebarComponent, TopbarComponent, forwardRef(() => AuthComponent)], templateUrl: './shell.html', host: { '(window:resize)': 'closeMenu()' } })
export class AppComponent {
  session = inject(SessionService); router = inject(Router); menuOpen = signal(false);
  nav = navigation;
  closeMenu() { const wasOpen = this.menuOpen(); this.menuOpen.set(false); if (wasOpen) setTimeout(() => document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus(), 0); }
  currentTitle() { return this.nav.find(n => n.path === this.router.url)?.title || 'Avaliação'; }
}
@Component({ selector: 'app-auth', standalone: true, imports: [FormsModule, Icons, ModalComponent, ErrorComponent], template: `
<app-modal [title]="register() ? 'Criar sua conta' : 'Entrar na conta'" (closed)="closed.emit()"><p class="muted">Salve pacientes, acompanhe avaliações e emita relatórios.</p><app-error [message]="error()"/><form class="stack" (ngSubmit)="submit()">
@if (register()) { <label>Nome<input [(ngModel)]="name" name="name" autocomplete="name" required minlength="2" maxlength="100"/></label> }
<label>E-mail<input type="email" [(ngModel)]="email" name="email" autocomplete="email" required maxlength="254"/></label><label>Senha<input type="password" [(ngModel)]="password" name="password" [attr.autocomplete]="register() ? 'new-password' : 'current-password'" required minlength="12" maxlength="128"/></label><p class="field-hint">Use pelo menos 12 caracteres.</p><button class="button" [disabled]="busy()">@if (busy()) { <lucide-icon name="loader-circle" class="spin" [size]="18"/> }{{register() ? 'Criar conta' : 'Entrar'}}</button></form><button class="text-button auth-toggle" (click)="register.set(!register()); error.set('')">{{register() ? 'Já tenho conta' : 'Criar uma conta'}}</button></app-modal>` })
export class AuthComponent {
  session = inject(SessionService); @Output() closed = new EventEmitter<void>();
  register = signal(false); busy = signal(false); error = signal(''); name = ''; email = ''; password = '';
  async submit() {
    const schema = z.object({ email: z.email('Informe um e-mail válido.'), password: z.string().min(12, 'Use pelo menos 12 caracteres.').max(128), ...(this.register() ? { name: z.string().trim().min(2, 'Informe seu nome.').max(100) } : {}) });
    const data = schema.safeParse({ email: this.email, password: this.password, ...(this.register() ? { name: this.name } : {}) });
    if (!data.success) { this.error.set(data.error.issues[0].message); return; }
    this.busy.set(true); this.error.set('');
    try { const s = await api<AuthResponse>(this.register() ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(data.data) }); this.session.accept(s); this.session.notice.set('Você entrou na conta. Os campos da avaliação foram preservados.'); }
    catch (e) { this.error.set((e as Error).message); } finally { this.busy.set(false); }
  }
}
