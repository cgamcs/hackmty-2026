import { OrderWithProducts } from "@/src/types"

type OrderItemProps = {
  order: OrderWithProducts
}

export default function OrderItem({order}: OrderItemProps) {
  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-5 ">
      <p className="text-lg font-bold text-slate-600">Cliente: {order.name}</p>

      <ul
        className="divide-y divide-gray-200 border-t border-gray-200 text-sm font-medium text-gray-500"
        role="list"
      >
        {order.orderProducts.map(product => (
          <li
            key={product.id}
            className="flex py-6 text-lg"
          >
            <p>
              <span className="font-bold">({product.quantity}) {''}</span>
              {product.product.name}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
