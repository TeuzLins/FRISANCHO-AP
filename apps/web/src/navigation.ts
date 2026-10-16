import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnChanges, OnDestroy, SimpleChanges, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Icons, SessionService } from './shared';
export const navigation = [{ path: '/', title: 'Avaliação', icon: 'calculator' }, { path: '/pacientes', title: 'Pacientes', icon: 'users' }, { path: '/historico', title: 'Histórico', icon: 'clipboard-list' }, { path: '/referencias', title: 'Referências', icon: 'book-open' }, { path: '/configuracoes', title: 'Configurações', icon: 'settings' }];
@Component({ selector: 'app-sidebar', standalone: true, imports: [RouterLink, RouterLinkActive, Icons], template: `
<aside #sidebar id="main-navigation" class="sidebar" [class.open]="open" [attr.inert]="mobile() && !open ? '' : null" aria-label="Navegação principal" (keydown)="trapFocus($event)"><div class="sidebar-brand-row"><a routerLink="/" class="brand" (click)="close()"><span class="brand-icon"><lucide-icon name="activity" [size]="25"/></span><span><strong>FRISANCHO <b>AP</b></strong><small>Avaliação antropométrica</small></span></a><button class="icon-button sidebar-close" aria-label="Fechar menu" (click)="close()"><lucide-icon name="x" [size]="20"/></button></div><span class="nav-label">NAVEGAÇÃO</span><nav>@for (n of navigation; track n.path) { <a [routerLink]="n.path" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}" ariaCurrentWhenActive="page" (click)="close()"><lucide-icon [name]="n.icon" [size]="20"/><span>{{n.title}}</span><span class="active-dot"></span></a> }</nav><div class="sidebar-bottom"><span>FRISANCHO AP <span>v1.0</span></span></div></aside>` })
export class SidebarComponent implements OnChanges, OnDestroy {
  private media = window.matchMedia('(max-width: 1023px)');
  mobile = signal(this.media.matches);
  private mediaChanged = (event: MediaQueryListEvent) => this.mobile.set(event.matches);
  constructor() { this.media.addEventListener('change', this.mediaChanged); }
  ngOnDestroy() { this.media.removeEventListener('change', this.mediaChanged); }
  @Input() open = false; @Output() closed = new EventEmitter<void>(); @ViewChild('sidebar') sidebar!: ElementRef<HTMLElement>; session = inject(SessionService); navigation = navigation;
  ngOnChanges(changes: SimpleChanges) { if (changes['open']?.currentValue) setTimeout(() => this.sidebar.nativeElement.querySelector<HTMLAnchorElement>('nav a.active')?.focus(), 0); }
  close() { this.closed.emit(); this.session.notice.set(''); }
  trapFocus(event: KeyboardEvent) {
    if (!this.open) return;
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const links = Array.from(this.sidebar.nativeElement.querySelectorAll<HTMLElement>('a,button')).filter(el => el.getBoundingClientRect().width > 0);
    const first = links[0], last = links[links.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}
@Component({ selector: 'app-topbar', standalone: true, imports: [Icons], template: `
<header class="topbar"><div class="topbar-page"><button class="icon-button mobile-menu" aria-label="Abrir menu" [attr.aria-expanded]="menuOpen" aria-controls="main-navigation" (click)="toggleMenu.emit()"><lucide-icon name="menu" [size]="23"/></button><span class="topbar-title">{{title}}</span></div><div class="topbar-account">@if (session.loading()) { <lucide-icon name="loader-circle" class="spin" [size]="18"/> } @else if (session.user(); as user) { <span class="user-avatar">{{user.name[0].toUpperCase()}}</span><span class="user-name">{{user.name}}</span><button class="icon-button" aria-label="Sair da conta" (click)="session.logout()"><lucide-icon name="log-out" [size]="18"/></button> } @else { <button class="button small outline" (click)="session.authOpen.set(true)">Entrar na conta <lucide-icon name="arrow-right" [size]="16"/></button> }</div></header>` })
export class TopbarComponent { @Input() title = 'Avaliação'; @Input() menuOpen = false; @Output() toggleMenu = new EventEmitter<void>(); session = inject(SessionService); }
