import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AdminComponent } from './pages/admin/admin.component';
import { LoginComponent } from './pages/login/login.component';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [authGuard],
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

  {
    path: ':slug',
    component: HomeComponent,
  },

  {
    path: '',
    redirectTo: 'home/1',
    pathMatch: 'full',
  },

  {
    path: '**',
    redirectTo: 'home/1',
  }
];