// src/app/guards/auth.guard.ts
import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

export const authGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);
  const sesion = await supabaseService.obtenerSesion();

  if (sesion) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};