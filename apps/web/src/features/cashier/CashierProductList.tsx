import type { OperationBoard } from "@rundflug/contracts";
import { AlertTriangle, Ticket } from "lucide-react";
import { Button } from "../../design-system/components";
import { oversizeSplitPreview } from "../../operational-exceptions";
import { formatAbsoluteTimeWindow } from "../../time-window";
import { productSaleBlockReason } from "../operations/sale-availability";

type CashierProduct = OperationBoard["products"][number];

export function CashierProductList({
  board,
  busyProductId,
  currency,
  onSell,
  serverConfirmed,
  size,
}: Readonly<{
  board: OperationBoard | null;
  busyProductId: string | null;
  currency: (cents: number) => string;
  onSell: (product: CashierProduct) => void;
  serverConfirmed: boolean;
  size: number;
}>) {
  const evaluatedAt = Date.now();
  return (
    <div className="cashier-products">
      {board?.products.map((product) => {
        const splitPreview = oversizeSplitPreview(size, product.referenceCapacity);
        const splitDescriptionId = `cashier-split-${product.id}`;
        const saleDisabled =
          !serverConfirmed ||
          productSaleBlockReason(board.event, product, evaluatedAt) !== null ||
          busyProductId !== null;
        return (
          <article className="cashier-product" key={product.id}>
            <div className="cashier-product-row">
              <span className="cashier-product-name">
                <strong>{product.name}</strong>
                <small>
                  {product.publicDescription ||
                    `Flugzeit ca. ${product.promisedFlightMinutes} Min.`}
                </small>
              </span>
              <span className="cashier-product-metric">
                <small>Zeitfenster</small>
                <strong>
                  {formatAbsoluteTimeWindow({
                    lowerAt: product.nextBoardingWindowLowerAt,
                    upperAt: product.nextBoardingWindowUpperAt,
                    timeZone: board.event.timeZone,
                    quality: product.predictionQuality,
                  })}
                </strong>
              </span>
              <span className="cashier-product-metric">
                <small>Kapazität</small>
                <strong>
                  {product.remainingSellableSeats}/{product.projectedSeats}
                </strong>
              </span>
              <span className="cashier-product-price">
                <small>Preis / Person</small>
                <strong>{currency(product.priceCents)}</strong>
              </span>
              <Button
                aria-describedby={splitDescriptionId}
                aria-label={`${size} Ticket${size === 1 ? "" : "s"} für ${product.name} verkaufen, ${currency(product.priceCents * size)}`}
                className="cashier-sell-action"
                disabled={saleDisabled}
                busy={busyProductId === product.id}
                busyLabel={`${size} Ticket${size === 1 ? "" : "s"} für ${product.name} werden verkauft`}
                onClick={() => onSell(product)}
                type="button"
                variant="primary"
              >
                <Ticket aria-hidden="true" size={20} />
                <span className="cashier-sell-copy">
                  <span>
                    {size} Ticket{size === 1 ? "" : "s"}
                  </span>
                  <span>{currency(product.priceCents * size)}</span>
                </span>
              </Button>
            </div>
            <div
              className={
                splitPreview.required ? "cashier-split-line warning" : "cashier-split-line"
              }
              id={splitDescriptionId}
            >
              {splitPreview.required ? (
                <>
                  <AlertTriangle aria-hidden="true" size={16} />
                  <span>
                    Aufteilung: {splitPreview.slotSizes.join(" + ")} Personen in{" "}
                    {splitPreview.slotSizes.length} aufeinanderfolgenden Fluggruppen; die
                    Buchungsgruppe bleibt verbunden.
                  </span>
                </>
              ) : (
                <span aria-hidden="true">&nbsp;</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
