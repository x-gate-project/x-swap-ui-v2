import { Currency } from '@uniswap/sdk-core'
import blankTokenUrl from 'assets/svg/blank_token.svg'
import { ReactComponent as UnknownStatus } from 'assets/svg/contract-interaction.svg'
import {
  CircleLogoImage,
  DoubleCurrencyLogo,
  DoubleLogo,
  L2LogoContainer,
  SingleLogoContainer,
} from 'components/DoubleLogo'
import Identicon from 'components/Identicon'
import { ChainLogo } from 'components/Logo/ChainLogo'
import React from 'react'
import styled from 'styled-components'
import { InterfaceChainId, UniverseChainId } from 'uniswap/src/types/chains'

const UnknownContract = styled(UnknownStatus)`
  color: ${({ theme }) => theme.neutral2};
`

const LogoContainer = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  top: 0;
  left: 0;
`

interface PortfolioLogoProps {
  chainId: InterfaceChainId
  dstChainId?: InterfaceChainId
  accountAddress?: string
  currencies?: Array<Currency | undefined>
  images?: Array<string | undefined>
  size?: number
  style?: React.CSSProperties
}

function SquareL2Logo({ chainId, size }: { chainId: InterfaceChainId; size: number }) {
  if (chainId === UniverseChainId.Mainnet) {
    return null
  }

  return (
    <L2LogoContainer $size={size}>
      <ChainLogo fillContainer={true} chainId={chainId} />
    </L2LogoContainer>
  )
}

const LOGO_DEFAULT_SIZE = 40

// TODO(WEB-2983)
/**
 * Renders an image by prioritizing a list of sources, and then eventually a fallback contract icon
 */
export function PortfolioLogo(props: PortfolioLogoProps) {
  const size = props.size ?? LOGO_DEFAULT_SIZE
  // Cross-chain: src badge bottom-left (under src token half), dst badge bottom-right.
  if (props.dstChainId && props.dstChainId !== props.chainId) {
    return (
      <LogoContainer style={props.style}>
        {getLogo(props)}
        <L2LogoContainer $size={size} style={{ left: 'auto', right: '60%' }}>
          <ChainLogo fillContainer={true} chainId={props.chainId} />
        </L2LogoContainer>
        <L2LogoContainer $size={size}>
          <ChainLogo fillContainer={true} chainId={props.dstChainId} />
        </L2LogoContainer>
      </LogoContainer>
    )
  }
  return (
    <LogoContainer style={props.style}>
      {getLogo(props)}
      <SquareL2Logo chainId={props.chainId} size={size} />
    </LogoContainer>
  )
}

function getLogo({ accountAddress, currencies, images, size = LOGO_DEFAULT_SIZE }: PortfolioLogoProps) {
  if (accountAddress) {
    return <Identicon account={accountAddress} size={size} />
  }
  if (currencies && currencies.length) {
    return <DoubleCurrencyLogo currencies={currencies} size={size} />
  }
  if (images?.length === 1) {
    return (
      <SingleLogoContainer size={size}>
        <CircleLogoImage size={size} src={images[0] ?? blankTokenUrl} />
      </SingleLogoContainer>
    )
  }
  if (images && images?.length >= 2) {
    return <DoubleLogo logo1={images[0]} logo2={images[images.length - 1]} size={size} />
  }
  return <UnknownContract width={size} height={size} />
}
