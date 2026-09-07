import { expect, type Page, test } from '@playwright/test'

/**
 * The dev config uses `admin.autoLogin`, so the admin lands on the Dashboard
 * directly. If the login form is shown anyway, fill it in manually.
 */
const ensureLoggedIn = async (page: Page) => {
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  if (await page.locator('#field-email').first().isVisible().catch(() => false)) {
    await page.fill('#field-email', 'admin@payloadcms.com')
    await page.fill('#field-password', 'test')
    await page.click('.form-submit button')
  }

  await expect(page).toHaveTitle(/Dashboard/)
}

test('soft delete action in the list view marks a document', async ({ page }) => {
  await ensureLoggedIn(page)

  const title = `Soft Delete ${Date.now()}`
  const res = await page.request.post('/api/posts', { data: { title } })
  expect(res.status).toBe(201)
  const { doc } = await res.json()

  await page.goto(`/admin/collections/posts?sort=-updatedAt&limit=10`)
  await expect(page.getByText(title)).toBeVisible()

  await page.getByRole('button', { name: 'Soft delete', exact: true }).first().click()
  await expect(
    page.getByRole('button', { name: 'Soft deleted', exact: true }).first(),
  ).toBeVisible({ timeout: 15_000 })

  // The document still exists after soft delete; it is marked, not removed.
  const payloadApi = await page.request.get(`/api/posts/${doc.id}`)
  expect(payloadApi.status).toBe(200)
  const body = await payloadApi.json()
  expect(body.doc.isSoftDeleted).toBe(true)
})

test('native delete is unavailable in the UI and the API', async ({ page }) => {
  await ensureLoggedIn(page)

  const title = `No Delete ${Date.now()}`
  const res = await page.request.post('/api/posts', { data: { title } })
  expect(res.status).toBe(201)
  const { doc } = await res.json()

  // REST DELETE is blocked by the plugin's access control
  const del = await page.request.delete(`/api/posts/${doc.id}`)
  expect(del.status).toBe(403)

  // Admin edit view does not offer a Delete button
  await page.goto(`/admin/collections/posts/${doc.id}`)
  await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible()
})