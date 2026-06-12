//+------------------------------------------------------------------+
//| CrossfireEA.mq5                                                  |
//| Polls the Crossfire web app signal endpoint and auto-places      |
//| trades on the MT5 account with correct SL/TP.                    |
//|                                                                  |
//| SETUP:                                                           |
//| 1. Copy this file to: MT5 → File → Open Data Folder →           |
//|    MQL5 → Experts → CrossfireEA.mq5                             |
//| 2. Compile: press F7 in MetaEditor                               |
//| 3. In MT5: Tools → Options → Expert Advisors →                  |
//|    ✓ Allow automated trading                                     |
//|    ✓ Allow WebRequests for listed URLs                           |
//|    Add: https://crossfire-your-app.vercel.app                   |
//|    (or http://localhost:5173 for local dev)                      |
//| 4. Attach EA to EUR/USD M5 chart                                 |
//| 5. Set input parameters below                                    |
//+------------------------------------------------------------------+
#property copyright "Crossfire Strategy"
#property version   "1.00"
#property strict

//--- Input parameters
input string   SignalURL        = "https://forexbattle.vercel.app/api/signal";
input string   SignalKey        = "";          // Set to your SIGNAL_KEY env var value
input double   RiskPercent      = 1.0;        // % of account balance to risk per trade
input int      PollSeconds      = 10;         // How often to check for a new signal
input int      MagicNumber      = 20260113;   // Unique ID for this EA's trades
input bool     EnableTrading    = true;       // Master on/off switch

//--- Trailing stop inputs (all off by default)
input bool     EnableTrailing   = false;  // Enable trailing stop management
input double   BreakevenAtR     = 1.0;    // Move SL to breakeven when X R in profit (0 = off)
input int      BreakevenBuffer  = 2;      // Extra pips past entry for breakeven SL
input double   TrailStartR      = 2.0;    // Begin trailing when X R in profit (0 = off)
input int      TrailStepPips    = 5;      // Trail step in pips (SL stays this far behind price)

//--- Global state
datetime g_lastPollTime = 0;
int      g_signalId     = -1;   // last processed signal ID (prevents re-entry)

//+------------------------------------------------------------------+
int OnInit()
{
   Print("[Crossfire EA] Initialised. Polling: ", SignalURL);
   Print("[Crossfire EA] Risk: ", RiskPercent, "% | Poll: every ", PollSeconds, "s");
   EventSetTimer(PollSeconds);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTick()  {}  // All logic runs on timer, not tick

//+------------------------------------------------------------------+
void OnTimer()
{
   if (!EnableTrading) return;
   PollAndTrade();
   ManagePositions();
}

//+------------------------------------------------------------------+
void PollAndTrade()
{
   uchar  result[];
   uchar  data[];   // empty array for GET request
   string headers = "Content-Type: application/json\r\n";
   if (StringLen(SignalKey) > 0)
      headers += "X-Signal-Key: " + SignalKey + "\r\n";

   string resHeaders;
   int    timeout   = 5000;  // 5 second HTTP timeout
   int    httpCode  = WebRequest("GET", SignalURL, headers, timeout, data, result, resHeaders);

   if (httpCode != 200)
   {
      if (httpCode == -1)
         Print("[Crossfire EA] WebRequest failed — check URL is in allowed list");
      return;
   }

   string body = CharArrayToString(result);

   // Check pending flag first (fast path, no JSON parsing)
   if (StringFind(body, "\"pending\":false") >= 0) return;
   if (StringFind(body, "\"pending\":true") < 0)   return;

   // Extract signal fields with simple string parsing
   string direction = ExtractField(body, "\"direction\":\"", "\"");
   string pair      = ExtractField(body, "\"pair\":\"",      "\"");
   double slPips    = StringToDouble(ExtractField(body, "\"slPips\":",  ","));
   double tpPips    = StringToDouble(ExtractField(body, "\"tpPips\":",  ","));
   string idStr     = ExtractField(body, "\"id\":",          ",");
   int    signalId  = (int)StringToInteger(idStr);

   // Don't re-process the same signal
   if (signalId == g_signalId)
   {
      Print("[Crossfire EA] Signal #", signalId, " already processed, skipping");
      return;
   }

   // Validate fields
   if (StringLen(direction) == 0 || slPips <= 0 || tpPips <= 0)
   {
      Print("[Crossfire EA] Invalid signal fields, ignoring. Body: ", body);
      return;
   }

   // Check this EA is on the right symbol
   if (StringLen(pair) > 0 && StringFind(Symbol(), StringSubstr(pair, 0, 3)) < 0)
   {
      Print("[Crossfire EA] Signal is for ", pair, " but chart symbol is ", Symbol(), " — skipping");
      return;
   }

   // Calculate lot size from risk % using slPips
   double lotSize = CalcLotSize(slPips);
   if (lotSize <= 0)
   {
      Print("[Crossfire EA] Lot size calculation failed");
      return;
   }

   // Place trade — SL/TP calculated from actual fill price using pip offsets
   ENUM_ORDER_TYPE orderType = (direction == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   bool            placed    = PlaceTrade(orderType, slPips, tpPips, lotSize);

   if (placed)
   {
      g_signalId = signalId;
      Print("[Crossfire EA] Trade placed — ", direction,
            " | SL: ", slPips, "p | TP: ", tpPips, "p | Lots: ", lotSize);
   }
}

//+------------------------------------------------------------------+
double CalcLotSize(double slPips)
{
   SymbolSelect(Symbol(), true);   // ensure symbol data is loaded
   double balance     = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount  = balance * RiskPercent / 100.0;

   // Use SYMBOL_POINT to handle both 3-digit (JPY) and 5-digit brokers
   double point   = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   int    digits  = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double pipSize = point * ((digits == 3 || digits == 5) ? 10 : 1);
   double slDist  = slPips * pipSize;
   if (slDist == 0) return 0;

   double tickValue   = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize    = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   if (tickValue == 0 || tickSize == 0)
   {
      Print("[Crossfire EA] Symbol info unavailable — tickValue=", tickValue, " tickSize=", tickSize);
      return 0;
   }

   double pipValue    = tickValue / tickSize * slDist;
   double lots        = riskAmount / pipValue;

   // Round to broker's step
   double lotStep     = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   double minLot      = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN);
   double maxLot      = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MAX);
   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   return lots;
}

//+------------------------------------------------------------------+
bool PlaceTrade(ENUM_ORDER_TYPE type, double slPips, double tpPips, double lots)
{
   MqlTradeRequest req = {};
   MqlTradeResult  res = {};

   double point     = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   int    digits    = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double pipSize   = point * ((digits == 3 || digits == 5) ? 10 : 1);
   double fillPrice = (type == ORDER_TYPE_BUY)
                      ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
                      : SymbolInfoDouble(Symbol(), SYMBOL_BID);

   double sl, tp;
   if (type == ORDER_TYPE_BUY)
   {
      sl = fillPrice - slPips * pipSize;
      tp = fillPrice + tpPips * pipSize;
   }
   else
   {
      sl = fillPrice + slPips * pipSize;
      tp = fillPrice - tpPips * pipSize;
   }

   // Enforce broker's minimum stop distance
   int    stopsLevel = (int)SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   double minDist    = stopsLevel * point + point;  // +1 point buffer
   if (type == ORDER_TYPE_BUY)
   {
      if ((fillPrice - sl) < minDist) sl = fillPrice - minDist;
      if ((tp - fillPrice) < minDist) tp = fillPrice + minDist;
   }
   else
   {
      if ((sl - fillPrice) < minDist) sl = fillPrice + minDist;
      if ((fillPrice - tp) < minDist) tp = fillPrice - minDist;
   }
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);

   // Auto-detect filling mode supported by this symbol
   int fillFlags = (int)SymbolInfoInteger(Symbol(), SYMBOL_FILLING_MODE);
   ENUM_ORDER_TYPE_FILLING filling;
   if      ((fillFlags & SYMBOL_FILLING_FOK) != 0) filling = ORDER_FILLING_FOK;
   else if ((fillFlags & SYMBOL_FILLING_IOC) != 0) filling = ORDER_FILLING_IOC;
   else                                             filling = ORDER_FILLING_RETURN;

   Print("[Crossfire EA] ", EnumToString(type),
         " price=", fillPrice, " sl=", sl, " tp=", tp,
         " lots=", lots, " filling=", EnumToString(filling),
         " stopsLevel=", stopsLevel);

   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = Symbol();
   req.volume       = lots;
   req.type         = type;
   req.price        = fillPrice;
   req.sl           = sl;
   req.tp           = tp;
   req.magic        = MagicNumber;
   req.comment      = StringFormat("Crossfire:%.1f", slPips);  // encodes original SL for trailing logic
   req.type_filling = filling;

   bool ok = OrderSend(req, res);
   if (!ok || res.retcode != TRADE_RETCODE_DONE)
      Print("[Crossfire EA] OrderSend failed: retcode=", res.retcode, " | ", res.comment);
   return ok && res.retcode == TRADE_RETCODE_DONE;
}

//+------------------------------------------------------------------+
// Trailing stop manager — called every timer tick
void ManagePositions()
{
   if (!EnableTrailing) return;

   double point   = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   int    digits  = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double pipSize = point * ((digits == 3 || digits == 5) ? 10 : 1);
   int    stopsLv = (int)SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopsLv * point + point;

   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket))                          continue;
      if ((int)PositionGetInteger(POSITION_MAGIC) != MagicNumber)  continue;
      if (PositionGetString(POSITION_SYMBOL) != Symbol())          continue;

      // Original SL pips are encoded in comment as "Crossfire:11.5"
      string comment   = PositionGetString(POSITION_COMMENT);
      int    sep       = StringFind(comment, ":");
      if (sep < 0) continue;
      double origSlPips = StringToDouble(StringSubstr(comment, sep + 1));
      if (origSlPips <= 0) continue;

      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl    = PositionGetDouble(POSITION_SL);
      double tp    = PositionGetDouble(POSITION_TP);

      double currentPrice = (posType == POSITION_TYPE_BUY)
                            ? SymbolInfoDouble(Symbol(), SYMBOL_BID)
                            : SymbolInfoDouble(Symbol(), SYMBOL_ASK);

      double rUnit   = origSlPips * pipSize;  // 1R in price distance
      double profitR = (posType == POSITION_TYPE_BUY)
                       ? (currentPrice - entry) / rUnit
                       : (entry - currentPrice) / rUnit;

      double newSl = sl;

      // ── Step 1: Breakeven ──────────────────────────────────────────
      if (BreakevenAtR > 0 && profitR >= BreakevenAtR)
      {
         double beSl = (posType == POSITION_TYPE_BUY)
                       ? entry + BreakevenBuffer * pipSize
                       : entry - BreakevenBuffer * pipSize;
         beSl = NormalizeDouble(beSl, digits);
         if (posType == POSITION_TYPE_BUY  && beSl > newSl) newSl = beSl;
         if (posType == POSITION_TYPE_SELL && beSl < newSl) newSl = beSl;
      }

      // ── Step 2: Trail ─────────────────────────────────────────────
      if (TrailStartR > 0 && profitR >= TrailStartR)
      {
         double trailSl = (posType == POSITION_TYPE_BUY)
                          ? currentPrice - TrailStepPips * pipSize
                          : currentPrice + TrailStepPips * pipSize;
         trailSl = NormalizeDouble(trailSl, digits);
         if (posType == POSITION_TYPE_BUY  && trailSl > newSl) newSl = trailSl;
         if (posType == POSITION_TYPE_SELL && trailSl < newSl) newSl = trailSl;
      }

      if (newSl == sl) continue;  // nothing to update

      // Enforce broker minimum stop distance from current price
      if (posType == POSITION_TYPE_BUY  && (currentPrice - newSl) < minDist) continue;
      if (posType == POSITION_TYPE_SELL && (newSl - currentPrice) < minDist) continue;

      MqlTradeRequest req = {};
      MqlTradeResult  res = {};
      req.action   = TRADE_ACTION_SLTP;
      req.symbol   = Symbol();
      req.position = ticket;
      req.sl       = newSl;
      req.tp       = tp;

      bool ok = OrderSend(req, res);
      if (ok && res.retcode == TRADE_RETCODE_DONE)
         Print("[Crossfire EA] SL moved to ", newSl, " at ", profitR, "R profit");
      else
         Print("[Crossfire EA] SL move failed: retcode=", res.retcode);
   }
}

//+------------------------------------------------------------------+
// Minimal JSON field extractor — no library dependency
string ExtractField(const string &json, const string &key, const string &terminator)
{
   int start = StringFind(json, key);
   if (start < 0) return "";
   start += StringLen(key);
   int end = StringFind(json, terminator, start);
   if (end < 0) end = StringLen(json);
   return StringSubstr(json, start, end - start);
}
//+------------------------------------------------------------------+
