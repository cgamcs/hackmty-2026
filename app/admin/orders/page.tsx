"use client"

import useSWR from "swr"
import OrderCard from "@/components/admin/OrderCard"
import Heading from "@/components/ui/Heading"
import { OrderWithProducts } from "@/src/types"

export default function OrdersPage() {
  const url = '/admin/orders/api'
  const fetcher = () => fetch(url).then(res => res.json()).then(data => data)
  const { data, error, isLoading } = useSWR<OrderWithProducts[]>(url, fetcher, {
    refreshInterval:  60000,
    revalidateOnFocus: false
  })

  if (isLoading) return <p className="text-center">Cargando...</p>
  
  if (data) return (
    <>
      <Heading>
        Administrar Ordenes
      </Heading>

      {data.length ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 mt-5">
          {data.map(order => (
            <OrderCard
              key={order.id}
              order={order}
            />
          ))}
        </div>
      ) : <p className="">No hay ordenes pendientes</p>}
    </>
  )
}