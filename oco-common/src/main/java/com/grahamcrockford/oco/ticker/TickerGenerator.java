package com.grahamcrockford.oco.ticker;

import java.util.Collection;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.knowm.xchange.Exchange;
import org.knowm.xchange.dto.marketdata.Ticker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.common.annotations.VisibleForTesting;
import com.google.common.collect.HashMultimap;
import com.google.common.collect.Multimap;
import com.google.common.eventbus.EventBus;
import com.google.common.util.concurrent.AbstractExecutionThreadService;
import com.google.inject.Inject;
import com.google.inject.Singleton;
import com.grahamcrockford.oco.exchange.ExchangeService;
import com.grahamcrockford.oco.spi.TickerSpec;
import com.grahamcrockford.oco.util.Sleep;

import info.bitrich.xchangestream.core.ProductSubscription;
import info.bitrich.xchangestream.core.ProductSubscription.ProductSubscriptionBuilder;
import info.bitrich.xchangestream.core.StreamingExchange;
import info.bitrich.xchangestream.core.StreamingMarketDataService;
import io.reactivex.disposables.Disposable;

@Singleton
@VisibleForTesting
public class TickerGenerator extends AbstractExecutionThreadService {

  private static final Logger LOGGER = LoggerFactory.getLogger(TickerGenerator.class);

  private final Set<TickerSpec> activePolling = Collections.newSetFromMap(new ConcurrentHashMap<TickerSpec, Boolean>());
  private final Multimap<String, Disposable> subsPerExchange = HashMultimap.create();
  private final Multimap<String, TickerSpec> tickersPerExchange = HashMultimap.create();

  private final EventBus eventBus;
  private final ExchangeService exchangeService;
  private final Sleep sleep;


  @Inject
  @VisibleForTesting
  public TickerGenerator(EventBus eventBus, ExchangeService exchangeService, Sleep sleep) {
    this.exchangeService = exchangeService;
    this.eventBus = eventBus;
    this.sleep = sleep;
  }

  /**
   * Updates the subscriptions for the specified exchanges.
   *
   * @param byExchange The exchanges and subscriptions for each.
   */
  public void updateSubscriptions(Multimap<String, TickerSpec> byExchange) {
    LOGGER.info("Updating subscriptions to: " + byExchange);
    byExchange.asMap().entrySet().forEach(entry -> {
      Exchange exchange = exchangeService.get(entry.getKey());
      Collection<TickerSpec> specsForExchange = entry.getValue();
      boolean streaming = exchange instanceof StreamingExchange;
      if (streaming) {
        subscribe(specsForExchange, exchange);
      } else {
        activePolling.addAll(specsForExchange);
        LOGGER.info("Subscribing to ticker poll: " + specsForExchange);
      }
    });
  }

  private synchronized void subscribe(Collection<TickerSpec> specsForExchange, Exchange exchange) {

    if (specsForExchange.isEmpty())
      return;

    LOGGER.info("Subscribing to ticker streams: " + specsForExchange);

    StreamingExchange streamingExchange = (StreamingExchange)exchange;
    String exchangeName = specsForExchange.iterator().next().exchange();

    // Remove all the old subscriptions and disconnect
    unsubscribeAll(streamingExchange, exchangeName);

    // Add our new ticker
    tickersPerExchange.putAll(exchangeName, specsForExchange);

    resubscribeAll(streamingExchange, tickersPerExchange.get(exchangeName));
    LOGGER.info("Subscribed to ticker stream: " + specsForExchange);
  }

  private void unsubscribeAll(StreamingExchange streamingExchange, String exchange) {
    Collection<Disposable> oldSubs = subsPerExchange.get(exchange);
    if (!oldSubs.isEmpty()) {
      LOGGER.info("Disconnecting from exchange: " + exchange);
      streamingExchange.disconnect().blockingAwait(); // Seems odd but this avoids an NPE when unsubscribing

      if (!oldSubs.isEmpty()) {
        oldSubs.forEach(Disposable::dispose);
      }
      subsPerExchange.removeAll(exchange);
    }
  }

  private void resubscribeAll(StreamingExchange streamingExchange, Collection<TickerSpec> tickers) {
    if (tickers.isEmpty())
      return;

    // Connect, specifying all the tickers we need
    ProductSubscriptionBuilder builder = ProductSubscription.create();
    tickers.stream().map(TickerSpec::currencyPair).forEach(builder::addTicker);
    streamingExchange.connect(builder.build()).blockingAwait();

    // Add the subscriptions
    StreamingMarketDataService marketDataService = streamingExchange.getStreamingMarketDataService();
    for (TickerSpec s : tickers) {
      Disposable subscription = marketDataService
          .getTicker(s.currencyPair())
          .subscribe(
            ticker -> onTicker(s, ticker),
            throwable -> LOGGER.error("Error in subscribing tickers.", throwable)
          );
      subsPerExchange.put(s.exchange(), subscription);
    }
  }

  private void onTicker(TickerSpec spec, Ticker ticker) {
    LOGGER.debug("Got ticker {} on {}", ticker, spec);
    eventBus.post(TickerEvent.create(spec, ticker));
  }

  @Override
  protected void run() {
    Thread.currentThread().setName("Ticker generator");
    LOGGER.info(this + " started");
    while (isRunning()) {
      try {
        activePolling.forEach(this::fetchAndBroadcast);
      } catch (Throwable e) {
        LOGGER.error("Serious error. Trying to stay alive", e);
      }
      try {
        sleep.sleep();
      } catch (InterruptedException e) {
        break;
      }
    }
    LOGGER.info(this + " stopped");
  }

  private void fetchAndBroadcast(TickerSpec spec) {
    try {
      Ticker ticker = exchangeService.get(spec.exchange()).getMarketDataService().getTicker(spec.currencyPair());
      onTicker(spec, ticker);
    } catch (Throwable e) {
      LOGGER.error("Failed fetching ticker: " + spec, e);
    }
  }
}