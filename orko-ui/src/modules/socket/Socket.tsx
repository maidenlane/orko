/*
 * Orko
 * Copyright © 2018-2019 Graham Crockford
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import React, { useEffect, ReactElement, useContext, useState, useMemo, useCallback } from "react"

import { AuthContext } from "@orko-ui-auth/index"
import { LogContext, LogRequest } from "@orko-ui-log/index"

import * as socketClient from "./socket.client"
import { locationToCoin } from "../../selectors/coins"
import { SocketContext, SocketApi } from "./SocketContext"
import { Coin } from "@orko-ui-market/index"
import { Map } from "immutable"
import { Ticker, Balance, OrderBook, Trade, UserTrade, Order } from "./Types"
import { useArray } from "@orko-ui-common/util/hookUtils"
import { useOrders } from "./useOrders"

const MAX_PUBLIC_TRADES = 48

export interface SocketProps {
  store
  children: ReactElement
}

/**
 * Manages the socket, disconnecting when authentication is lost and
 * reconnecting when enabled, and then dispatching any updates to
 * the store.
 *
 * This is an interim measure as I break up the redux store and switch
 * to individual contexts, as has now been done for this and Authoriser.
 *
 * @param props
 */
export const Socket: React.FC<SocketProps> = (props: SocketProps) => {
  //////////////////////// SOCKET STATE ////////////////////////////

  // Contexts required
  const authApi = useContext(AuthContext)
  const logApi = useContext(LogContext)

  // Connection state
  const [connected, setConnected] = useState(false)

  //////////////////////// MARKET DATA /////////////////////////////

  // Data from the socket
  const [tickers, setTickers] = useState(Map<String, Ticker>())
  const [balances, setBalances] = useState(Map<String, Balance>())
  const [orderBook, setOrderBook] = useState<OrderBook>(null)
  const [trades, tradesUpdateApi] = useArray<Trade>(null)
  const [userTrades, userTradesUpdateApi] = useArray<UserTrade>(null)
  const [openOrders, openOrdersUpdateApi] = useOrders()

  /////////////////////// SOCKET MANAGEMENT ///////////////////////////

  const getSubscribedCoins = useCallback(() => props.store.getState().coins.coins, [props.store])
  const getSelectedCoin = useCallback(() => locationToCoin(props.store.getState().router.location), [
    props.store
  ])

  const location = props.store.getState().router.location
  const selectedCoin = useMemo(() => locationToCoin(location), [location])
  const selectedCoinTicker = useMemo(() => (selectedCoin ? tickers.get(selectedCoin.key) : null), [
    tickers,
    selectedCoin
  ])

  // Forward notifications/errors to the log API
  const logError = logApi.localError
  const logMessage = logApi.localMessage
  const logNotification = logApi.add
  useEffect(() => {
    socketClient.onError((message: string) => logError(message))
    socketClient.onNotification((logEntry: LogRequest) => logNotification(logEntry))
  }, [props.store, logError, logNotification])

  // Dispatch market data to the store
  useEffect(() => {
    const sameCoin = (left: Coin, right: Coin) => left && right && left.key === right.key
    socketClient.onTicker((coin: Coin, ticker: Ticker) =>
      setTickers(tickers => tickers.set(coin.key, ticker))
    )
    socketClient.onBalance((exchange: string, currency: string, balance: Balance) => {
      const coin = getSelectedCoin()
      if (coin && coin.exchange === exchange) {
        if (coin.base === currency) {
          setBalances(balances => Map.of(currency, balance, coin.counter, balances.get(coin.counter)))
        }
        if (coin.counter === currency) {
          setBalances(balances => Map.of(currency, balance, coin.base, balances.get(coin.base)))
        }
      }
    })
    socketClient.onOrderBook((coin: Coin, orderBook: OrderBook) => {
      if (sameCoin(coin, getSelectedCoin())) setOrderBook(orderBook)
    })
    socketClient.onTrade((coin: Coin, trade: Trade) => {
      if (sameCoin(coin, getSelectedCoin())) tradesUpdateApi.unshift(trade, { maxLength: MAX_PUBLIC_TRADES })
    })
    socketClient.onUserTrade((coin: Coin, trade: UserTrade) => {
      if (sameCoin(coin, getSelectedCoin()))
        userTradesUpdateApi.unshift(trade, {
          skipIfAnyMatch: existing => !!trade.id && existing.id === trade.id
        })
    })
    socketClient.onOrderUpdate((coin: Coin, order: Order, timestamp: number) => {
      if (sameCoin(coin, getSelectedCoin())) openOrdersUpdateApi.orderUpdated(order, timestamp)
    })
    socketClient.onOrdersSnapshot((coin: Coin, orders: Array<Order>, timestamp: number) => {
      if (sameCoin(coin, getSelectedCoin())) {
        openOrdersUpdateApi.updateSnapshot(orders, timestamp)
      }
    })
  }, [props.store, getSelectedCoin, tradesUpdateApi, userTradesUpdateApi, openOrdersUpdateApi])

  // Connect the socket when authorised, and disconnect when deauthorised
  useEffect(() => {
    if (authApi.authorised) {
      socketClient.connect()
    }
    return () => socketClient.disconnect()
  }, [authApi.authorised])

  // Sync the state of the socket with the socket itself
  useEffect(() => {
    socketClient.onConnectionStateChange((newState: boolean) => setConnected(newState))
  }, [setConnected])

  // Log when the socket connects and resubscribe
  const resubscribe = useCallback(() => {
    socketClient.changeSubscriptions(getSubscribedCoins(), getSelectedCoin())
    socketClient.resubscribe()
  }, [getSubscribedCoins, getSelectedCoin])
  useEffect(() => {
    if (connected) {
      logMessage("Socket connected")
      resubscribe()
      return () => logMessage("Socket disconnected")
    }
  }, [connected, logMessage, resubscribe])

  // When the coin selected changes, send resubscription messages and clear any
  // coin-specific state
  useEffect(() => {
    console.log("Resubscribing following coin change")
    socketClient.changeSubscriptions(getSubscribedCoins(), selectedCoin)
    socketClient.resubscribe()
    setOrderBook(null)
    userTradesUpdateApi.clear()
    openOrdersUpdateApi.clear()
    tradesUpdateApi.clear()
    setBalances(Map<String, Balance>())
  }, [
    props.store,
    connected,
    getSubscribedCoins,
    selectedCoin,
    userTradesUpdateApi,
    tradesUpdateApi,
    openOrdersUpdateApi
  ])

  const createdOrder = openOrdersUpdateApi.orderUpdated
  const pendingCancelOrder = openOrdersUpdateApi.pendingCancelOrder
  const createPlaceholder = openOrdersUpdateApi.createPlaceholder
  const removePlaceholder = openOrdersUpdateApi.removePlaceholder

  const api: SocketApi = useMemo(
    () => ({
      connected,
      resubscribe,
      tickers,
      balances,
      trades,
      userTrades,
      orderBook,
      openOrders,
      selectedCoinTicker,
      createdOrder,
      pendingCancelOrder,
      createPlaceholder,
      removePlaceholder
    }),
    [
      connected,
      resubscribe,
      tickers,
      balances,
      trades,
      userTrades,
      orderBook,
      openOrders,
      selectedCoinTicker,
      createdOrder,
      pendingCancelOrder,
      createPlaceholder,
      removePlaceholder
    ]
  )

  return <SocketContext.Provider value={api}>{props.children}</SocketContext.Provider>
}