import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service'; 

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  cargando = false;

  // Estados para modales / mensajes
  mostrarModal = false;
  tipoModal: 'cargando' | 'exito' | 'error' | 'recuperar' | 'recuperar-exito' = 'cargando';
  errorLogin = '';
  emailRecuperacion = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private supabaseSvc: SupabaseService,
    private cdr: ChangeDetectorRef // Inyectamos para asegurar la actualización de vistas
  ) {}

  ngOnInit(): void {
    // 1. RECUERDO DE EMAIL (Recordarme)
    const emailGuardado = localStorage.getItem('remember_email') || '';

    this.loginForm = this.fb.group({
      email: [emailGuardado, [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      recordarme: [!!emailGuardado]
    });
  }

  // Helper para validación corta en HTML
  f(field: string) {
    return this.loginForm.get(field);
  }

  // ----------------------------------------------------
  // A) INICIAR SESIÓN (con Recordarme)
  // ----------------------------------------------------
  async onSubmit(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { email, password, recordarme } = this.loginForm.value;

    // Manejo de "Recordarme"
    if (recordarme) {
      localStorage.setItem('remember_email', email);
    } else {
      localStorage.removeItem('remember_email');
    }

    this.cargando = true;
    this.tipoModal = 'cargando';
    this.mostrarModal = true;
    this.cdr.detectChanges();

    try {
      const res = await this.supabaseSvc.signIn(email, password);
      if (res?.error) {
        throw res.error;
      }

      this.tipoModal = 'exito';
      this.cdr.detectChanges(); 

      setTimeout(() => {
        this.cerrarModal();
        this.router.navigate(['/admin']);
      }, 1500);

    } catch (err: any) {
      this.tipoModal = 'error';
      this.errorLogin = this.obtenerMensajeError(err?.message);
      this.cdr.detectChanges();
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  private obtenerMensajeError(msg: string): string {
    if (!msg) return 'Ocurrió un error inesperado. Por favor reintentá.';
    
    const lower = msg.toLowerCase();
    if (lower.includes('invalid login credentials') || lower.includes('invalid_grant')) {
      return 'El correo o la contraseña son incorrectos. Verificá tus datos.';
    }
    if (lower.includes('email not confirmed')) {
      return 'Debes confirmar tu correo electrónico antes de ingresar.';
    }
    if (lower.includes('too many requests') || lower.includes('rate limit')) {
      return 'Demasiados intentos fallidos. Aguardá unos minutos e intentalo de nuevo.';
    }
    return msg;
  }
  onIrARegistro(): void {
    this.router.navigate(['/registro']);
  }

  abrirRecuperarPassword(): void {
    this.emailRecuperacion = this.f('email')?.value || '';
    this.tipoModal = 'recuperar';
    this.mostrarModal = true;
    this.cdr.detectChanges();
  }

  async enviarMailRecuperacion(): Promise<void> {
    if (!this.emailRecuperacion || !this.emailRecuperacion.includes('@')) {
      alert('Por favor ingresá un email válido');
      return;
    }

    this.cargando = true;
    this.cdr.detectChanges();

    try {
      const res = await this.supabaseSvc.resetPasswordForEmail(this.emailRecuperacion);
      if (res?.error) throw res.error;

      this.tipoModal = 'recuperar-exito';
    } catch (err: any) {
      alert('Error al enviar el correo: ' + (err?.message || 'Intentá de nuevo.'));
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  cerrarModal(): void {
    this.mostrarModal = false;
    this.cdr.detectChanges();
  }
}