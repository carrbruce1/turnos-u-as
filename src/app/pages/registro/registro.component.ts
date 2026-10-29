import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './registro.component.html',
  styleUrl: './registro.component.css'
})
export class RegistroComponent {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private supabase = inject(SupabaseService);

  cargando = false;
  mostrarModal = false;
  tipoModal: 'cargando' | 'exito' | 'error' = 'cargando';
  errorRegistro = '';

  registroForm: FormGroup = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    nombreNegocio: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    telefono: ['', [Validators.required, Validators.minLength(8)]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  f(campo: string) {
    return this.registroForm.get(campo);
  }

  private generarSlug(texto: string): string {
    return texto
      .toLowerCase()
      .trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  async onSubmit() {
  if (this.registroForm.invalid) {
    this.registroForm.markAllAsTouched();
    return;
  }

  this.cargando = true;
  this.tipoModal = 'cargando';
  this.mostrarModal = true;
  this.errorRegistro = '';

  const { nombre, nombreNegocio, email, telefono, password } = this.registroForm.value;
  const slugLocal = this.generarSlug(nombreNegocio);

  try {
    // 1. Crear usuario en Auth (enviando 'nombre' en options.data para que el trigger lo tome)
    const { data: authData, error: authError } = await this.supabase.signUpUser(email, password, {
      data: {
        nombre: nombre,
        nombre_negocio: nombreNegocio,
        telefono: telefono
      }
    } as any);

    if (authError) throw authError;

    const userId = authData.user?.id;
    if (!userId) throw new Error('No se pudo obtener el ID del usuario.');

    // 2. Crear el local en la tabla 'locales'
    const { data: localData, error: localError } = await this.supabase.supabase
      .from('locales')
      .insert([{
        nombre: nombreNegocio,
        slug: slugLocal
      }])
      .select()
      .single();

    if (localError) throw localError;

    // 3. Vincular el 'local_id' recién creado al perfil que el trigger autogeneró
    const { error: perfilUpdateError } = await this.supabase.supabase
      .from('perfiles')
      .update({ local_id: localData.id })
      .eq('id', userId);

    if (perfilUpdateError) throw perfilUpdateError;

    // Éxito
    this.tipoModal = 'exito';
    setTimeout(() => {
      this.cerrarModal();
      this.router.navigate(['/admin']);
    }, 2000);

  } catch (err: any) {
    this.cargando = false;
    this.tipoModal = 'error';
    this.errorRegistro = err.message || 'Ocurrió un error al registrar la cuenta.';
  }
}

  onIrALogin() {
    this.router.navigate(['/login']);
  }

  cerrarModal() {
    this.mostrarModal = false;
  }
}