import Column from 'components/Column'
import UniswapXBrandMark from 'components/Logo/UniswapXBrandMark'
import { RowBetween, RowFixed } from 'components/Row'
import Toggle from 'components/Toggle'
import { Trans } from 'i18n'
import { RouterPreference } from 'state/routing/types'
import { useRouterPreference } from 'state/user/hooks'
import { ThemedText } from 'theme/components'

export default function RouterPreferenceSettings() {
  const [routerPreference, setRouterPreference] = useRouterPreference()

  return (
    <RowBetween gap="sm">
      <RowFixed>
        <Column gap="xs">
          <ThemedText.BodySecondary>
            <UniswapXBrandMark />
          </ThemedText.BodySecondary>
          <ThemedText.BodySmall color="neutral2">
            <Trans i18nKey="routing.aggregateLiquidity" />{' '}
            {/* <ExternalLink href="https://support.uniswap.org/hc/en-us/articles/17515415311501">
              <InlineLink>Learn more</InlineLink>
            </ExternalLink> */}
          </ThemedText.BodySmall>
        </Column>
      </RowFixed>
      <Toggle
        id="toggle-uniswap-x-button"
        isActive={routerPreference === RouterPreference.X}
        toggle={() => {
          setRouterPreference(routerPreference === RouterPreference.X ? RouterPreference.API : RouterPreference.X)
        }}
      />
    </RowBetween>
  )
}
