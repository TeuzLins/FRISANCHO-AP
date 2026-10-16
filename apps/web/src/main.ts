import { bootstrapApplication } from '@angular/platform-browser';
import { importProvidersFrom } from '@angular/core';
import { iconProviders } from './shared';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app';
bootstrapApplication(AppComponent, { providers: [importProvidersFrom(iconProviders), provideRouter([
  { path: '', loadComponent: () => import('./evaluation').then(m => m.EvaluationComponent), title: 'Nova avaliação · FRISANCHO AP' },
  { path: 'pacientes', loadComponent: () => import('./patients').then(m => m.PatientsComponent), title: 'Pacientes · FRISANCHO AP' },
  { path: 'historico', loadComponent: () => import('./history').then(m => m.HistoryComponent), title: 'Histórico · FRISANCHO AP' },
  { path: 'referencias', loadComponent: () => import('./information').then(m => m.ReferencesComponent), title: 'Referências · FRISANCHO AP' },
  { path: 'configuracoes', loadComponent: () => import('./information').then(m => m.SettingsComponent), title: 'Configurações · FRISANCHO AP' },
  { path: '**', redirectTo: '' },
])] }).catch(() => console.error('Não foi possível iniciar a aplicação.'));
