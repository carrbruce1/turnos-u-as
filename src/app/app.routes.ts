import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AdminComponent } from './pages/admin/admin.component';
import { LoginComponent } from './pages/login/login.component';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  // 1. Rutas fijas y administrativas (tienen prioridad)
  {
    path: 'login',
    component: LoginComponent,
  },
  // {
  //   path: 'empleados',
  //   component: EmpleadosComponent,
  //   canActivate: [authGuard],
  // },
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [authGuard],
  },
  // {
  //   path: 'crear-usuario',
  //   loadComponent: () => import('./pages/admin/crear-usuario/crear-usuario.component').then(m => m.CrearUsuarioComponent),
  //   canActivate: [authGuard],
  // },
  // {
  //   path: 'cancelar-turno/:id',
  //   loadComponent: () => import('./pages/cancelar-turnos/cancelar-turnos.component').then(m => m.CancelarTurnosComponent)
  // },
  
  // {
//   path: 'ajustes',
//   loadComponent: () => import('./pages/ajustes/ajustes.component').then(m => m.AjustesComponent),
//   canActivate: [authGuard],
// },

  // 2. Compatibilidad con tus URLs anteriores
  {
    path: '',
    redirectTo: 'home/1',
    pathMatch: 'full',
  },
  {
    path: 'home',
    redirectTo: 'home/1',
    pathMatch: 'full',
  },
  {
    path: 'home/:id',
    component: HomeComponent,
  },

  // 3. RUTA LIMPIA PARA EL DOMINIO: Captura turnillos.site/laovejanegra
  {
    path: ':slug',
    component: HomeComponent,
  },

  // 4. Fallback de respaldo
  {
    path: '**',
    redirectTo: 'home/1',
  }
];