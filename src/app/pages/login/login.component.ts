import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  cargando = false;
  mostrarModal = false;
  tipoModal: 'cargando' | 'exito' | 'error' = 'cargando';
  errorLogin: string | null = null;

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  f(campo: string) {
    return this.loginForm.get(campo);
  }

  async onSubmit() {
    if (this.loginForm.invalid || this.cargando) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.cargando = true;
    this.mostrarModal = true;
    this.tipoModal = 'cargando';
    this.errorLogin = null;
    this.cdr.detectChanges();

    try {
      const { email, password } = this.loginForm.value;

      const res = await this.supabaseService
        .login(email, password)
        .catch((err: any) => ({ data: null, error: err }));

      if (!res || res.error) {
        console.warn('Error detectado en login:', res?.error);
        this.mostrarError('Email o contraseña incorrectos.');
        return;
      }

      const perfil = await this.supabaseService.obtenerPerfilUsuario().catch(() => null);

      // Éxito: el botón queda deshabilitado hasta redirigir
      this.tipoModal = 'exito';
      this.cdr.detectChanges();

      setTimeout(async () => {
        this.cerrarModal();
        const destino = perfil?.rol === 'admin' || perfil?.rol === 'empleado' ? '/admin' : '/home';
        await this.router.navigate([destino]);
        this.cargando = false;
      }, 1000);

    } catch (err) {
      console.error('Error imprevisto en Login:', err);
      this.mostrarError('Ocurrió un problema inesperado. Intentá nuevamente.');
    }
  }

  private mostrarError(mensaje: string) {
    this.errorLogin = mensaje;
    this.tipoModal = 'error';
    this.cargando = false;
    this.cdr.detectChanges();
  }

  cerrarModal() {
    this.mostrarModal = false;
    this.cdr.detectChanges();
  }
}