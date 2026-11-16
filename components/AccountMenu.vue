<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useEditorStore } from '~/stores/editor'
import { useCloud } from '~/composables/useCloud'
import { useReviewCampaignStore } from '~/stores/reviewCampaign'
import { ZVID_DISCORD_URL } from '~/utils/community'

const auth = useAuthStore()
const editor = useEditorStore()
const cloud = useCloud()
const reviewCampaign = useReviewCampaignStore()
const dashUrl = useRuntimeConfig().public.dashUrl as string

const open = ref(false)
const root = ref<HTMLElement>()
const toggle = ref<HTMLButtonElement>()

function onDocDown(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false
  }
}
onMounted(() => document.addEventListener('pointerdown', onDocDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown))

function closeMenu() {
  if (!open.value) return
  open.value = false
  toggle.value?.focus()
}

function signIn() {
  editor.postAuthModal = null
  editor.openModal('auth')
}

async function signOut() {
  open.value = false
  await auth.logout()
  editor.notify('Signed out', 'info')
}

function run(action: () => void) {
  open.value = false
  action()
}
</script>

<template>
  <div ref="root" class="account" @keydown.esc.stop="closeMenu">
    <a
      class="btn primary upgrade-action"
      :href="`${dashUrl}/subscription`"
      target="_blank"
      rel="noopener noreferrer"
      title="Upgrade your plan or buy credits (opens in a new tab)"
    >
      Upgrade
    </a>
    <button
      v-if="!auth.user"
      class="btn ghost"
      title="Sign in to save projects and templates to your Zvid account"
      @click="signIn"
    >
      <UiIcon name="user" :size="14" /> Sign in
    </button>

    <template v-else>
      <button
        ref="toggle"
        class="avatar"
        :title="auth.user.email"
        :aria-label="`Account for ${auth.user.email}`"
        :aria-expanded="open"
        aria-controls="account-menu"
        @click="open = !open"
      >
        {{ auth.initials }}
      </button>

      <div v-if="open" id="account-menu" class="menu">
        <div class="menu-head">
          <span class="email">{{ auth.user.email }}</span>
          <span v-if="auth.credits?.balance != null" class="credits">
            {{ Number(auth.credits.balance).toLocaleString() }} credits
          </span>
        </div>
        <a
          class="item upgrade-item"
          :href="`${dashUrl}/subscription`"
          target="_blank"
          rel="noopener noreferrer"
          @click="open = false"
        >
          <UiIcon name="link" :size="14" /> Upgrade plan / Buy credits
        </a>
        <button class="item" @click="run(cloud.openProjects)">
          <UiIcon name="folder" :size="14" /> My projects
        </button>
        <button class="item" @click="run(cloud.openSaveTemplate)">
          <UiIcon name="magic" :size="14" /> Save as template
        </button>
        <a class="item" :href="dashUrl" target="_blank" rel="noopener">
          <UiIcon name="link" :size="14" /> Open dashboard
        </a>
        <button class="item" @click="run(() => reviewCampaign.show(true))">
          <UiIcon name="link" :size="14" /> Share feedback / Review rewards
        </button>
        <a
          class="item"
          :href="ZVID_DISCORD_URL"
          target="_blank"
          rel="noopener noreferrer"
          @click="open = false"
        >
          <UiIcon name="discord" :size="14" /> Discord community
        </a>
        <div class="menu-sep" />
        <button class="item" @click="signOut">
          <UiIcon name="logout" :size="14" /> Sign out
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.account {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.upgrade-action {
  text-decoration: none;
  white-space: nowrap;
}
.account > .btn {
  height: var(--topbar-action-height, 36px);
}
.item.upgrade-item {
  color: var(--accent);
  font-weight: 600;
}
.avatar {
  width: var(--topbar-action-height, 36px);
  height: var(--topbar-action-height, 36px);
  border-radius: 50%;
  border: 1px solid var(--border-1);
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 260px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 80px);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  padding: 6px;
  z-index: 60;
}
.menu-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--border-0);
  margin-bottom: 6px;
}
.email {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.credits {
  font-size: 11px;
  color: var(--text-2);
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: none;
  border-radius: var(--radius-s);
  font-size: 12.5px;
  color: var(--text-1);
  cursor: pointer;
  text-decoration: none;
}
.item:hover {
  background: var(--bg-2);
  color: var(--text-0);
}
.menu-sep {
  height: 1px;
  background: var(--border-0);
  margin: 6px 0;
}
@media (max-width: 600px), (pointer: coarse) {
  .item {
    min-height: 40px;
  }
}
@media (max-width: 400px) {
  .account {
    max-width: 94px;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }
}
</style>
