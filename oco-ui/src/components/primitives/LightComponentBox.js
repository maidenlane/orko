import styled from 'styled-components';
import { space, padding } from 'styled-system'

const LightComponentBox = styled.div.attrs({
  pb: 3
})`
  background-color: ${props => props.theme.colors.backgrounds[3]};
  border: 1px solid ${props => props.theme.colors.boxBorder};
  ${space}
  ${padding}
`;

export default LightComponentBox;