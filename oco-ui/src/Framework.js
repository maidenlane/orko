import React from 'react';

import { Switch, Route, BrowserRouter } from 'react-router-dom';

import { Flex, Box } from 'rebass';
import { ThemeProvider } from 'styled-components';
import theme from './theme';

import CoinsContainer from './containers/CoinsContainer';
import JobsContainer from './containers/JobsContainer';

import ToolbarContainer from './containers/ToolbarContainer';
import AddCoinContainer from './containers/AddCoinContainer';

import MidComponentBox from './components/primitives/MidComponentBox';
import LightComponentBox from './components/primitives/LightComponentBox';

import Trading from './Trading';
import Market from './Market';
import JobView from './JobView';

// TEMP
import styled from 'styled-components';
import { space } from 'styled-system'

const BackgroundBox = styled.div`
  background-color: ${props => props.theme.colors.backgrounds[0]};
  height: 100vh;
  ${space}
`;

export default class Framework extends React.Component {
  render() {
    return (
      <BrowserRouter>
        <ThemeProvider theme={theme}>
          <BackgroundBox>
            <ToolbarContainer />
            <Flex flexWrap='wrap' h='calc(100%-66px)'>
              <Box width={[1, 170]} order={[3, 1]}>
                <LightComponentBox p={2}>
                  <CoinsContainer/>
                </LightComponentBox>
                <MidComponentBox p={2}>
                  <JobsContainer/>
                </MidComponentBox>
              </Box>
              <Switch>
                <Route exact path='/addCoin'
                  component={AddCoinContainer}/>
                <Route path='/coin/:exchange/:counter/:base'
                  component={Trading}/>
                <Route path='/job/:jobId'
                  component={JobView}/>
                <Route component={Trading}/>
              </Switch>
              <Switch>
                <Route path='/coin/:exchange/:counter/:base'
                  component={Market}/>
              </Switch>
            </Flex>
          </BackgroundBox>
        </ThemeProvider>
      </BrowserRouter>
    );
  }
}