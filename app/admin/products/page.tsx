import Pagination from "@/components/products/Pagination"
import ProductSearchForm from "@/components/products/ProductSearchForm"
import ProductTable from "@/components/products/ProductTable"
import Heading from "@/components/ui/Heading"
import { prisma } from "@/src/lib/prisma"
import Link from "next/link"
import { redirect } from "next/navigation"

async function productCount() {
  return await prisma.product.count()
}

async function getProducts(page: number, pageSize: number) {
  const skip = (page - 1) * pageSize

  const products = await prisma.product.findMany({
    take: pageSize,
    skip,
    include: {
      category: true
    }
  })

  return products
}

export type ProductsWithCategory = Awaited<ReturnType<typeof getProducts>>

export default async function ProductsPage({searchParams} : {searchParams: { page: string }}) {
  const page = +searchParams.page || 1
  const pageSize = 10

  if (page < 0) redirect('/admin/products')

  const prodcutsData = getProducts(page, pageSize)
  const totalProductsData = productCount()
  const [ prodcuts, totalProducts ] = await Promise.all([prodcutsData, totalProductsData])
  const totalPages = Math.ceil(totalProducts / pageSize)

  if (page > totalPages || page < 0) redirect('/admin/products')
  return (
    <>
      <Heading>
        Administrar Productos
      </Heading>

      <div className="flex flex-col lg:flex-row lg:justify-between gap-5">
        <Link
          href={'/admin/products/new'}
          className="bg-amber-400 w-full lg:w-auto text-xl px-8 py-2.5 text-center font-bold cursor-pointer"
        >Crear Producto</Link>

        <ProductSearchForm />
      </div>

      <ProductTable
        products={prodcuts}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
      />
    </>
  )
}
