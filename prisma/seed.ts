import { exit } from "node:process"
import { categories } from "./data/categories"
import { products } from "./data/products"
import { PrismaClient } from "@/src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

async function main() {
  try {
    await prisma.category.createMany({
      data: categories
    })
    await prisma.product.createMany({
      data: products
    })
    console.log('Seed ejecutado correctamente')
  } catch (error) {
    console.log(error)
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })