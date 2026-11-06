import { useTranslation } from 'react-i18next'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'

export interface MenuItem {
  label: string
  href: string
  internal?: boolean
  overflow?: boolean
  target?: string
  closeMenu?: () => void
}

export interface MenuSection {
  title: string
  items: MenuItem[]
  closeMenu?: () => void
}

export const useMenuContent = (): MenuSection[] => {
  const { t } = useTranslation()
  const isLegacyNav = !useFeatureFlag(FeatureFlags.NavRefresh)

  const legacyAppLinks = {
    title: t('common.app'),
    key: 'App',
    items: [
      { label: t('common.pool'), href: '/pool', internal: true, overflow: true },
      { label: t('common.vote'), href: 'https://vote.uniswapfoundation.org/' },
      { label: t('common.analytics'), href: '/explore', internal: true },
    ],
  }

  return [...(isLegacyNav ? [legacyAppLinks] : [])]
}
