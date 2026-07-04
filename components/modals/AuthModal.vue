<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useEditorStore } from '~/stores/editor'

const auth = useAuthStore()
const editor = useEditorStore()
const dashUrl = useRuntimeConfig().public.dashUrl as string

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value || !email.value.trim() || !password.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await auth.login(email.value.trim(), password.value)
    if (result.success) {
      const next = editor.postAuthModal
      editor.postAuthModal = null
      editor.notify('Signed in', 'success')
      if (next) editor.openModal(next)
      else editor.closeModal()
    } else {
      error.value = result.error || 'Login failed'
    }
  } catch {
    error.value = 'Could not reach the server — try again.'
  } finally {
    busy.value = false
  }
}

function cancel() {
  editor.postAuthModal = null
  editor.closeModal()
}
</script>

<template>
  <UiModal title="Sign in to Zvid" width="400px" @close="cancel">
    <p class="hint">
      Saving projects and templates needs a free Zvid account — everything
      else in the editor works without one.
    </p>

    <form class="form" @submit.prevent="submit">
      <label class="field">
        <span class="label">Email</span>
        <input
          v-model="email"
          class="ctl"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          autofocus
        />
      </label>
      <label class="field">
        <span class="label">Password</span>
        <input
          v-model="password"
          class="ctl"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
        />
      </label>

      <p v-if="error" class="err">{{ error }}</p>

      <button
        class="btn primary submit"
        type="submit"
        :disabled="busy || !email.trim() || !password"
      >
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <div class="links">
      <a :href="`${dashUrl}/register`" target="_blank" rel="noopener">
        Create a free account
      </a>
      <a :href="`${dashUrl}/forgot-password`" target="_blank" rel="noopener">
        Forgot password?
      </a>
    </div>
  </UiModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
}
.ctl {
  width: 100%;
  height: 32px;
}
.submit {
  margin-top: 4px;
  justify-content: center;
}
.err {
  color: var(--red);
  font-size: 12px;
  margin: 0;
  background: color-mix(in srgb, var(--red) 8%, transparent);
  padding: 7px 10px;
  border-radius: var(--radius-s);
}
.links {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
  font-size: 12px;
}
.links a {
  color: var(--accent-strong);
  text-decoration: none;
}
.links a:hover {
  text-decoration: underline;
}
</style>
