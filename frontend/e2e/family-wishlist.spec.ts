import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { requiresOwnedGroupCleanup } from './cleanupDecision'

type ServerInfo = { config: string; database: string; url: string }

test('family wishlist full application workflow', async ({ browser }, testInfo) => {
  test.setTimeout(120_000)
  const repoRoot = resolve(process.cwd(), '..')
  const server = spawn(join(repoRoot, '.venv/bin/python'), [join(repoRoot, 'frontend/e2e/server.py')], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  })
  const stderr: string[] = []
  server.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))
  const serverOutput: string[] = []
  const stdout = readLines(server, serverOutput)
  let context: BrowserContext | undefined
  let secondContext: BrowserContext | undefined
  let robinContext: BrowserContext | undefined
  let identityRaceContext: BrowserContext | undefined
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const failedResponses: Array<{ status: number; url: string }> = []
  try {
    const info = await nextJson<ServerInfo>(stdout, server, stderr)
    let readiness: Response
    try {
      readiness = await fetch(info.url)
    } catch (error) {
      throw new Error(`Vite URL ${info.url} was unreachable; wrapper exit=${server.exitCode}; stdout=${serverOutput.join(' | ')}; stderr=${stderr.join('')}`, { cause: error })
    }
    expect(readiness.status, `Vite readiness for ${info.url}`).toBe(200)
    context = await browser.newContext({ viewport: testInfo.project.use.viewport })
    const page = await context.newPage()
    auditPage(page, pageErrors, consoleErrors, failedResponses)
    await page.goto(info.url)
    await page.getByRole('heading', { name: 'Choose your name' }).waitFor()
    await page.getByRole('button', { name: 'Alex', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()

    const add = async (name: string, event?: string, multiple = false) => {
      await page.getByRole('button', { name: 'Add a gift' }).click()
      const form = page.locator('.item-form')
      await expect(form.getByRole('checkbox', { name: 'Can be purchased multiple times' })).not.toBeChecked()
      await expect(form.getByLabel(/price/i)).toHaveCount(0)
      const geometry = await page.evaluate(() => {
        const form = document.querySelector('.item-form')!.getBoundingClientRect()
        const main = document.querySelector('main.page-shell')!.getBoundingClientRect()
        return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          mainLeft: main.left, mainWidth: main.width, formLeft: form.left, formWidth: form.width }
      })
      expect(geometry.scrollWidth, `horizontal overflow: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.viewport)
      expect(Math.abs((geometry.formLeft + geometry.formWidth / 2) - (geometry.mainLeft + geometry.mainWidth / 2)),
        `form must be centered in main content: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1)
      await form.getByLabel('Gift name').fill(name)
      if (event) await form.getByLabel(/occasion/i).selectOption({ label: event })
      if (multiple) await form.getByLabel('Can be purchased multiple times').check()
      const createRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/items/'))
      await form.getByRole('button', { name: 'Save gift' }).click()
      const payload = JSON.parse((await createRequest).postData() ?? '{}') as Record<string, unknown>
      expect(payload.name).toBe(name)
      expect(payload).not.toHaveProperty('price')
      await expect(page.getByRole('heading', { name })).toBeVisible()
      await expect(giftCard(page, name).getByText(/\$\d/)).toHaveCount(0)
    }
    await add('Anything notebook')
    await add('Birthday picnic', 'Birthday')
    await add('Christmas board game', 'Christmas', true)
    await add('Keyboard delete target')
    const birthdayFilter = page.getByLabel('Filter by occasion')
    await birthdayFilter.selectOption({ label: 'Birthday' })
    await expect(page.getByRole('heading', { name: 'Anything notebook' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Birthday picnic' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Christmas board game' })).toHaveCount(0)

    const profilesResponse = await page.request.get(`${info.url}/api/profiles/`)
    const profiles = await profilesResponse.json() as Array<{ id: number; key: string }>
    const alexId = profiles.find((profile) => profile.key === 'alex')!.id
    const samId = profiles.find((profile) => profile.key === 'sam')!.id
    const itemsResponse = await page.request.get(`${info.url}/api/profiles/${alexId}/items/`)
    expect(itemsResponse.ok()).toBeTruthy()
    const ownerItems = await itemsResponse.json() as Array<Record<string, unknown>>
    for (const item of ownerItems) {
      expect(item).not.toHaveProperty('purchases')
      expect(item).not.toHaveProperty('buyers')
      expect(item).not.toHaveProperty('can_purchase')
      expect(item).not.toHaveProperty('can_undo')
    }
    const birthday = ownerItems.find((item) => item.name === 'Birthday picnic')!
    const multi = ownerItems.find((item) => item.name === 'Christmas board game')!
    expect(birthday).toBeTruthy()
    expect(multi).toBeTruthy()
    const birthdayId = birthday.id as number
    const birthdayEventId = (birthday.event as { id: number }).id
    const multiId = multi.id as number
    const christmasEventId = (multi.event as { id: number }).id
    const csrfToken = (await context.cookies(info.url)).find((cookie) => cookie.name === 'csrftoken')?.value
    expect(csrfToken).toBeTruthy()
    const legacyPriceResponse = await page.request.patch(`${info.url}/api/items/${birthdayId}/`, {
      headers: { 'X-CSRFToken': csrfToken! },
      data: { price: '€42.50' },
    })
    expect(legacyPriceResponse.ok()).toBeTruthy()
    await giftCard(page, 'Birthday picnic').getByRole('button', { name: 'Edit gift' }).click()
    await expect(page.locator('.item-form').getByLabel(/price/i)).toHaveCount(0)
    await page.getByLabel('Gift name').fill('Birthday outing')
    await page.getByRole('button', { name: 'Save gift' }).click()
    await expect(page.getByRole('heading', { name: 'Birthday outing' })).toBeVisible()
    await expect(giftCard(page, 'Birthday outing').getByText('€42.50', { exact: true })).toHaveCount(0)
    const legacyPriceAfterEdit = await page.request.get(`${info.url}/api/profiles/${alexId}/items/`)
    const editedBirthday = (await legacyPriceAfterEdit.json() as Array<Record<string, unknown>>)
      .find((item) => item.id === birthdayId)
    expect(editedBirthday?.price).toBe('€42.50')

    secondContext = await browser.newContext({ viewport: testInfo.project.use.viewport })
    const sam = await secondContext.newPage()
    auditPage(sam, pageErrors, consoleErrors, failedResponses)
    await chooseAndOpen(sam, info.url, 'Sam')
    robinContext = await browser.newContext({ viewport: testInfo.project.use.viewport })
    const robin = await robinContext.newPage()
    auditPage(robin, pageErrors, consoleErrors, failedResponses)
    await chooseAndOpen(robin, info.url, 'Robin')

    const samBirthday = sam.locator('.gift-card').filter({ has: sam.getByRole('heading', { name: 'Birthday outing' }) })
    const samMulti = sam.locator('.gift-card').filter({ has: sam.getByRole('heading', { name: 'Christmas board game' }) })
    const robinBirthday = robin.locator('.gift-card').filter({ has: robin.getByRole('heading', { name: 'Birthday outing' }) })
    const robinMulti = robin.locator('.gift-card').filter({ has: robin.getByRole('heading', { name: 'Christmas board game' }) })
    await samBirthday.getByRole('button', { name: 'Mark purchased' }).click()
    await expect(samBirthday.getByText('Already marked by: Sam')).toBeVisible()
    await expect(samBirthday.getByRole('button', { name: 'Undo my purchase' })).toBeVisible()
    await expect(samBirthday.getByRole('button', { name: 'Mark purchased' })).toHaveCount(0)
    await robinBirthday.getByRole('button', { name: 'Mark purchased' }).click()
    await expect(robin.getByRole('status').filter({ hasText: 'already purchased' })).toBeVisible()
    await expect(robin.getByText('Already marked by: Sam')).toBeVisible()

    await samMulti.getByRole('button', { name: 'Mark purchased' }).click()
    await expect(samMulti.getByText('Already marked by: Sam')).toBeVisible()
    await robinMulti.getByRole('button', { name: 'Mark purchased' }).click()
    await expect(robinMulti.getByText('Already marked by: Sam, Robin')).toBeVisible()
    await sam.reload()
    await sam.getByRole('button', { name: 'Family wishlists' }).click()
    await sam.getByRole('button', { name: 'View Alex’s wishlist' }).click()
    await expect(sam.getByText('Already marked by: Sam, Robin')).toBeVisible()
    await samMulti.getByRole('button', { name: 'Undo my purchase' }).click()
    await expect(samMulti.getByText('Already marked by: Robin')).toBeVisible()
    await expect(samMulti.getByRole('button', { name: 'Undo my purchase' })).toHaveCount(0)

    // Re-fetch owner state only after purchases exist, and verify the refreshed
    // owner UI remains free of buyer identities/current purchase marks.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    const refreshedBirthdayCard = giftCard(page, 'Birthday outing')
    const refreshedMultiCard = giftCard(page, 'Christmas board game')
    await expect(refreshedBirthdayCard).toBeVisible()
    await expect(refreshedMultiCard).toBeVisible()
    const purchasedOwnerResponse = await page.request.get(`${info.url}/api/profiles/${alexId}/items/`)
    expect(purchasedOwnerResponse.ok()).toBeTruthy()
    const purchasedOwnerItems = await purchasedOwnerResponse.json() as Array<Record<string, unknown>>
    const refreshedOwnerIds = purchasedOwnerItems.map((item) => item.id)
    expect(refreshedOwnerIds).toEqual(expect.arrayContaining([birthdayId, multiId]))
    for (const item of purchasedOwnerItems) {
      expect(item).not.toHaveProperty('purchases')
      expect(item).not.toHaveProperty('buyers')
      expect(item).not.toHaveProperty('can_purchase')
      expect(item).not.toHaveProperty('can_undo')
    }
    for (const card of [refreshedBirthdayCard, refreshedMultiCard]) {
      await expect(card.getByText(/Already marked by:/)).toHaveCount(0)
      await expect(card.getByText('Sam', { exact: true })).toHaveCount(0)
      await expect(card.getByText('Robin', { exact: true })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Mark purchased' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Undo my purchase' })).toHaveCount(0)
    }

    // Use a separate real browser session so the held DELETE and PUT are each
    // isolated from the main workflow's already-confirmed identity.
    await add('Identity race gift', undefined, true)
    identityRaceContext = await browser.newContext({ viewport: testInfo.project.use.viewport })
    const identityRacePage = await identityRaceContext.newPage()
    auditPage(identityRacePage, pageErrors, consoleErrors, failedResponses)
    await identityRacePage.goto(info.url)
    await expect(identityRacePage.getByRole('heading', { name: 'Choose your name' })).toBeVisible()
    await identityRacePage.getByRole('button', { name: 'Alex', exact: true }).click()
    await expect(identityRacePage.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()

    // Clear lifecycle: the focused-tab GET still sees Alex until the held DELETE
    // reaches Django. It must not reopen authenticated content or outlive clear.
    let releaseClear!: () => void
    let observeClear!: () => void
    const clearHeld = new Promise<void>((resolve) => { releaseClear = resolve })
    const clearObserved = new Promise<void>((resolve) => { observeClear = resolve })
    const clearResponse = identityRacePage.waitForResponse((response) =>
      response.request().method() === 'DELETE' && response.url().endsWith('/api/session/'))
    let clearWritePending = true
    let clearFocusCheck = false
    let observeClearFocusCheck!: () => void
    const clearFocusCheckObserved = new Promise<void>((resolve) => { observeClearFocusCheck = resolve })
    await identityRacePage.route('**/api/session/', async (route) => {
      if (route.request().method() === 'DELETE') {
        observeClear()
        await clearHeld
      } else if (route.request().method() === 'GET' && clearWritePending) {
        clearFocusCheck = true
        observeClearFocusCheck()
      }
      await route.continue()
    })
    await identityRacePage.getByRole('button', { name: 'Switch name' }).click()
    await clearObserved
    const clearCheckResponse = identityRacePage.waitForResponse((response) => response.request().method() === 'GET'
      && response.url().endsWith('/api/session/')).catch(() => null)
    await identityRacePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitForRenderedFrames(identityRacePage)
    const observedClearCheck = await Promise.race([
      clearFocusCheckObserved.then(() => true),
      waitForRenderedFrames(identityRacePage).then(() => false),
    ])
    if (observedClearCheck) await clearCheckResponse
    const clearGateStayedClosed = await identityRacePage.getByRole('status').isVisible().catch(() => false)
      && !await identityRacePage.locator('.current-identity strong').isVisible().catch(() => false)
    clearWritePending = false
    releaseClear()
    await clearResponse
    await identityRacePage.unroute('**/api/session/')
    const clearedSessionResponse = await identityRacePage.request.get(`${info.url}/api/session/`)
    const clearedSession = await clearedSessionResponse.json() as { profile: { id: number; name: string } | null }
    const shownAfterClear = await visibleIdentityName(identityRacePage)
    const pickerAfterClear = await identityRacePage.getByRole('heading', { name: 'Choose your name' }).isVisible().catch(() => false)
    const clearUiMatchesServer = clearedSession.profile
      ? shownAfterClear === clearedSession.profile.name
      : shownAfterClear === null && pickerAfterClear
    await identityRacePage.reload()
    await expect(identityRacePage.getByRole('heading', { name: 'Choose your name' })).toBeVisible()

    // Choose lifecycle: hold Sam's real PUT before Django while a focus check
    // attempts to read the still-empty session and reopen the picker.
    let releaseSam!: () => void
    let observeSam!: () => void
    let observeFocusCheck!: () => void
    const samHeld = new Promise<void>((resolve) => { releaseSam = resolve })
    const samObserved = new Promise<void>((resolve) => { observeSam = resolve })
    const focusCheckObserved = new Promise<void>((resolve) => { observeFocusCheck = resolve })
    let samWritePending = true
    let focusCheckDuringSamWrite = false
    let holdFirstSamPut = true
    await identityRacePage.route('**/api/session/', async (route) => {
      const request = route.request()
      if (request.method() === 'PUT' && holdFirstSamPut
        && JSON.parse(request.postData() ?? '{}').profile_id === samId) {
        holdFirstSamPut = false
        observeSam()
        await samHeld
      } else if (request.method() === 'GET' && samWritePending) {
        focusCheckDuringSamWrite = true
        observeFocusCheck()
      }
      await route.continue()
    })
    const samResponse = identityRacePage.waitForResponse((response) => response.request().method() === 'PUT'
      && response.url().endsWith('/api/session/')
      && JSON.parse(response.request().postData() ?? '{}').profile_id === samId)
    await identityRacePage.getByRole('button', { name: 'Sam', exact: true }).click()
    await samObserved
    const focusCheckResponse = identityRacePage.waitForResponse((response) => response.request().method() === 'GET'
      && response.url().endsWith('/api/session/')).catch(() => null)
    await identityRacePage.evaluate(() => window.dispatchEvent(new Event('focus')))
    await waitForRenderedFrames(identityRacePage)
    const pickerDuringSamWrite = await identityRacePage.getByRole('heading', { name: 'Choose your name' }).isVisible().catch(() => false)
    const observedFocusCheck = await Promise.race([
      focusCheckObserved.then(() => true),
      waitForRenderedFrames(identityRacePage).then(() => false),
    ])
    if (observedFocusCheck) {
      await focusCheckResponse
      await expect(identityRacePage.getByRole('heading', { name: 'Choose your name' })).toBeVisible()
      await identityRacePage.getByRole('button', { name: 'Alex', exact: true }).click()
      await expect(identityRacePage.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    }
    const chooseGateStayedClosed = !pickerDuringSamWrite && !focusCheckDuringSamWrite
    samWritePending = false
    releaseSam()
    await samResponse
    await identityRacePage.unroute('**/api/session/')
    const postWriteSessionResponse = await identityRacePage.request.get(`${info.url}/api/session/`)
    const postWriteSession = await postWriteSessionResponse.json() as { profile: { id: number; name: string } | null }
    const displayedIdentityAfterSamWrite = await visibleIdentityName(identityRacePage)
    const displayedIdentityMatchesServer = displayedIdentityAfterSamWrite === (postWriteSession.profile?.name ?? null)

    // Normalize to Alex only after capturing the post-write agreement. A second
    // browser context buys the recipient's gift; Alex's own view must stay private.
    if (displayedIdentityAfterSamWrite !== 'Alex') {
      if (displayedIdentityAfterSamWrite !== null) {
        await identityRacePage.getByRole('button', { name: 'Switch name' }).click()
        await expect(identityRacePage.getByRole('heading', { name: 'Choose your name' })).toBeVisible()
      }
      await identityRacePage.getByRole('button', { name: 'Alex', exact: true }).click()
      await expect(identityRacePage.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    }
    await robin.reload()
    await expect(robin.getByRole('heading', { name: 'Robin’s wishlist' })).toBeVisible()
    await robin.getByRole('button', { name: 'Family wishlists' }).click()
    await robin.getByRole('button', { name: 'View Alex’s wishlist' }).click()
    const raceGiftForRobin = giftCard(robin, 'Identity race gift')
    await expect(raceGiftForRobin).toBeVisible()
    await raceGiftForRobin.getByRole('button', { name: 'Mark purchased' }).click()
    await expect(raceGiftForRobin.getByText('Already marked by: Robin')).toBeVisible()
    const refreshOwnerList = identityRacePage.getByRole('button', { name: 'Refresh wishlist' })
    await expect(refreshOwnerList).toBeEnabled()
    let releaseOwnerList!: () => void
    let observeOwnerList!: () => void
    const ownerListHeld = new Promise<void>((resolve) => { releaseOwnerList = resolve })
    const ownerListObserved = new Promise<void>((resolve) => { observeOwnerList = resolve })
    const ownerListResponse = identityRacePage.waitForResponse((response) =>
      response.request().method() === 'GET' && response.url().includes(`/api/profiles/${alexId}/items/`))
    await identityRacePage.route(new RegExp(`/api/profiles/${alexId}/items/`), async (route) => {
      observeOwnerList()
      await ownerListHeld
      await route.continue()
    }, { times: 1 })
    await refreshOwnerList.click()
    await ownerListObserved
    await expect(refreshOwnerList).toBeDisabled()
    releaseOwnerList()
    const ownerList = await (await ownerListResponse).json() as Array<Record<string, unknown>>
    const raceGiftPayload = ownerList.find((item) => item.name === 'Identity race gift')!
    const ownerResponseStayedPrivate = raceGiftPayload.is_owner === true && !('purchases' in raceGiftPayload)
    await expect(refreshOwnerList).toBeEnabled()
    const raceGiftForAlex = giftCard(identityRacePage, 'Identity race gift')
    await expect(raceGiftForAlex).toBeVisible()
    const ownBuyerWasVisible = await raceGiftForAlex.getByText(/Already marked by:/).count() > 0
    const ownerControlsStayedVisible = await raceGiftForAlex.getByRole('button', { name: 'Edit gift' }).count() === 1
    const identityRaceOutcome = {
      clearGateStayedClosed,
      clearFocusCheck,
      clearedSession: clearedSession.profile,
      shownAfterClear,
      pickerAfterClear,
      clearUiMatchesServer,
      chooseGateStayedClosed,
      focusCheckDuringSamWrite,
      pickerDuringSamWrite,
      displayedIdentityAfterSamWrite,
      serverIdentityAfterSamWrite: postWriteSession.profile,
      displayedIdentityMatchesServer,
      ownBuyerWasVisible,
      ownerResponseStayedPrivate,
      ownerControlsStayedVisible,
    }
    expect(identityRaceOutcome, JSON.stringify(identityRaceOutcome)).toEqual({
      clearGateStayedClosed: true,
      clearFocusCheck: false,
      clearedSession: null,
      shownAfterClear: null,
      pickerAfterClear: true,
      clearUiMatchesServer: true,
      chooseGateStayedClosed: true,
      focusCheckDuringSamWrite: false,
      pickerDuringSamWrite: false,
      displayedIdentityAfterSamWrite: 'Sam',
      serverIdentityAfterSamWrite: { id: samId, key: 'sam', name: 'Sam' },
      displayedIdentityMatchesServer: true,
      ownBuyerWasVisible: false,
      ownerResponseStayedPrivate: true,
      ownerControlsStayedVisible: true,
    })

    // Remove the currently selected event after opening its filter and edit draft.
    await page.getByLabel('Filter by occasion').selectOption({ label: 'Birthday' })
    await expect(page.getByRole('heading', { name: 'Birthday outing' })).toBeVisible()
    const birthdayEditCard = giftCard(page, 'Birthday outing')
    await birthdayEditCard.getByRole('button', { name: 'Edit gift' }).click()
    const birthdayForm = page.locator('.item-form')
    await birthdayForm.getByLabel('Notes').fill('Keep notes after catalog removal')

    // The config file and database are private to this run. A restart re-syncs labels
    // and archives the removed Birthday event without changing existing references.
    await writeFile(info.config, [
      'members:', '  alex: Alex', '  sam: Samuel', '  robin: Robin',
      'events:', '  christmas: Winter holidays', '',
    ].join('\n'))
    process.kill(server.pid!, 'SIGUSR1')
    await waitForLine(stdout, server, stderr, 'RESTARTED')

    const wishlistRequestsAfterRestart: string[] = []
    const recordWishlistRequest = (request: import('@playwright/test').Request) => {
      if (request.method() === 'GET' && request.url().includes(`/api/profiles/${alexId}/items/`)) {
        wishlistRequestsAfterRestart.push(request.url())
      }
    }
    page.on('request', recordWishlistRequest)
    const mainSessionRevalidation = page.waitForResponse((response) => response.request().method() === 'GET'
      && response.url().endsWith('/api/session/'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await mainSessionRevalidation
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    const refreshedFilter = page.getByLabel('Filter by occasion')
    await expect(refreshedFilter).toHaveValue('filter:all')
    await expect(refreshedFilter.getByRole('option', { name: 'Birthday' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Birthday outing' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Christmas board game' })).toBeVisible()
    await expect(birthdayForm.getByLabel('Notes')).toHaveValue('Keep notes after catalog removal')
    await expect(birthdayForm.getByLabel(/occasion/i)).toHaveValue(String(birthdayEventId))
    await expect(birthdayForm.getByRole('option', { name: 'Birthday (no longer configured; retained)' })).toHaveCount(1)
    await expect.poll(() => wishlistRequestsAfterRestart.some((url) => {
      const query = new URL(url).searchParams
      return !query.has('event')
    })).toBe(true)
    const latestWishlistRequest = wishlistRequestsAfterRestart.at(-1)
    expect(latestWishlistRequest).toBeTruthy()
    expect(new URL(latestWishlistRequest!).searchParams.has('event')).toBe(false)
    const birthdayPatchRequest = page.waitForRequest((request) => request.method() === 'PATCH'
      && request.url().endsWith(`/api/items/${birthdayId}/`))
    await birthdayForm.getByRole('button', { name: 'Save gift' }).click()
    const patchPayload = JSON.parse((await birthdayPatchRequest).postData() ?? '{}') as Record<string, unknown>
    expect(patchPayload.event_id).toBe(birthdayEventId)
    expect(patchPayload.notes).toBe('Keep notes after catalog removal')
    await expect(page.getByText('Keep notes after catalog removal')).toBeVisible()
    await expect(giftCard(page, 'Birthday outing').locator('.gift-event-label'))
      .toHaveText('Birthday (no longer configured)')
    page.off('request', recordWishlistRequest)

    await sam.reload()
    await expect(sam.getByText('Samuel', { exact: true })).toBeVisible()
    const samSessionResponse = await sam.request.get(`${info.url}/api/session/`)
    const samSession = await samSessionResponse.json() as { profile: { id: number; key: string; name: string } }
    expect(samSession.profile).toEqual({ id: samId, key: 'sam', name: 'Samuel' })
    await sam.getByRole('button', { name: 'Family wishlists' }).click()
    await sam.getByRole('button', { name: 'View Alex’s wishlist' }).click()
    await expect(sam.getByRole('heading', { name: 'Birthday outing' })).toBeVisible()
    await expect(sam.getByText('Birthday (no longer configured)')).toBeVisible()
    await expect(giftCard(sam, 'Christmas board game').locator('.gift-event-label')).toHaveText('Winter holidays')
    const afterRestartResponse = await sam.request.get(`${info.url}/api/profiles/${alexId}/items/`)
    const afterRestart = await afterRestartResponse.json() as Array<Record<string, unknown>>
    const birthdayAfter = afterRestart.find((item) => item.id === birthdayId)!
    const multiAfter = afterRestart.find((item) => item.id === multiId)!
    expect((birthdayAfter.event as { id: number }).id).toBe(birthdayEventId)
    expect((multiAfter.event as { id: number }).id).toBe(christmasEventId)
    expect((multiAfter as { purchases: Array<{ buyer_name: string }> }).purchases.map((mark) => mark.buyer_name)).toEqual(['Robin'])
    const profilesAfterRestartResponse = await sam.request.get(`${info.url}/api/profiles/`)
    const profilesAfterRestart = await profilesAfterRestartResponse.json() as Array<{ id: number; key: string; name: string }>
    expect(profilesAfterRestart.find((profile) => profile.key === 'sam')).toEqual({ id: samId, key: 'sam', name: 'Samuel' })
    expect(profilesAfterRestart.find((profile) => profile.key === 'alex')?.id).toBe(alexId)

    // Blur leaves authenticated content and draft in place; focus safely
    // revalidates the shared identity without remounting the editor.
    await giftCard(page, 'Anything notebook').getByRole('button', { name: 'Edit gift' }).click()
    const editForm = page.locator('.item-form')
    const giftName = editForm.getByLabel('Gift name')
    await giftName.fill('Focus draft preserved')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    await expect(page.getByText('Checking your identity…')).toHaveCount(0)
    const focusRevalidation = page.waitForResponse((response) =>
      response.request().method() === 'GET' && response.url().endsWith('/api/session/'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await focusRevalidation
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    await expect(giftName).toHaveValue('Focus draft preserved')
    await editForm.getByRole('button', { name: 'Cancel' }).click()

    // Dialog keyboard containment, pending/error state, and focus return after a
    // same-profile identity revalidation are exercised against the live app.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    const deleteCard = giftCard(page, 'Keyboard delete target')
    await deleteCard.getByRole('button', { name: 'Delete gift' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Delete gift' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await deleteCard.getByRole('button', { name: 'Delete gift' }).click()
    const deleteId = Number(await deleteCard.locator('[data-delete-item-id]').getAttribute('data-delete-item-id'))
    const triggerBeforeRevalidation = await page.locator(`[data-delete-item-id="${deleteId}"]`).elementHandle()
    let releaseDelete!: () => void
    const held = new Promise<void>((resolve) => { releaseDelete = resolve })
    await page.route(`**/api/items/${deleteId}/`, async (route) => {
      await held
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'database_busy', message: 'Please retry.' }) })
    })
    await dialog.getByRole('button', { name: 'Delete gift', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    let releasePendingSession!: () => void
    let observePendingSession!: () => void
    const pendingSessionHeld = new Promise<void>((resolve) => { releasePendingSession = resolve })
    const pendingSessionObserved = new Promise<void>((resolve) => { observePendingSession = resolve })
    const pendingSessionResponse = page.waitForResponse((response) =>
      response.request().method() === 'GET' && response.url().endsWith('/api/session/'))
    await page.route('**/api/session/', async (route) => {
      if (route.request().method() === 'GET') {
        observePendingSession()
        await pendingSessionHeld
      }
      await route.continue()
    }, { times: 1 })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await pendingSessionObserved
    await expect(page.getByText('Checking your identity…')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.authenticated-area [data-wishlist-heading]')).toBeVisible()
    await waitForRenderedFrames(page)
    expect(await page.evaluate(() => document.querySelector('[inert]') !== null), 'an inert authenticated subtree is rendered while both requests are pending').toBe(true)
    releasePendingSession()
    await pendingSessionResponse
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    await page.keyboard.press('Tab')
    await expect(dialog).toBeFocused()
    const pendingDeleteResponse = page.waitForResponse((response) => response.request().method() === 'DELETE'
      && response.url().endsWith(`/api/items/${deleteId}/`))
    releaseDelete()
    expect((await pendingDeleteResponse).status()).toBe(503)
    await expect(page.getByRole('alert')).toContainText('Please retry.')
    await expect(dialog).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator(`[data-delete-item-id="${deleteId}"]`)).toBeFocused()
    await page.unroute(`**/api/items/${deleteId}/`)
    await page.locator(`[data-delete-item-id="${deleteId}"]`).click()
    await page.route(`**/api/items/${deleteId}/`, (route) => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'identity_required', message: 'Choose your name again.' }),
    }), { times: 1 })
    const identityFailure = page.waitForResponse((response) =>
      response.status() === 403 && response.url().endsWith(`/api/items/${deleteId}/`))
    const revalidatedSession = page.waitForResponse((response) =>
      response.request().method() === 'GET' && response.url().endsWith('/api/session/'))
    let releaseSessionCheck!: () => void
    let observeSessionCheck!: () => void
    const sessionCheckHeld = new Promise<void>((resolve) => { releaseSessionCheck = resolve })
    const sessionCheckObserved = new Promise<void>((resolve) => { observeSessionCheck = resolve })
    await page.route('**/api/session/', async (route) => {
      if (route.request().method() === 'GET') {
        observeSessionCheck()
        await sessionCheckHeld
      }
      await route.continue()
    }, { times: 1 })
    await dialog.getByRole('button', { name: 'Delete gift', exact: true }).click()
    await identityFailure
    await sessionCheckObserved
    await expect(page.getByText('Checking your identity…')).toBeVisible()
    await expect(dialog).toBeHidden()
    await waitForRenderedFrames(page)
    const hiddenFocusTag = await page.evaluate(() => document.activeElement?.tagName)
    expect(hiddenFocusTag, 'focus after two rendered frames in the hidden/inert interval').toBe('BODY')
    releaseSessionCheck()
    await revalidatedSession
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete gift', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    const triggerAfterRevalidation = page.locator(`[data-delete-item-id="${deleteId}"]`)
    await expect(triggerAfterRevalidation).toBeVisible()
    const triggerWasRecreated = await triggerAfterRevalidation.evaluate((node, original) => node !== original, triggerBeforeRevalidation)
    expect(triggerWasRecreated, 'the return target must be the refreshed logical delete trigger').toBe(true)
    await page.unroute(`**/api/items/${deleteId}/`)
    await page.keyboard.press('Escape')
    const activeAfterCancel = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent,
      id: document.activeElement?.getAttribute('data-delete-item-id'),
      hidden: document.activeElement?.closest('[hidden]') !== null,
    }))
    expect(activeAfterCancel, 'focus after closing the revalidated delete dialog').toEqual({
      tag: 'BUTTON', text: 'Delete gift', id: String(deleteId), hidden: false,
    })
    await page.keyboard.press('Enter')
    await dialog.getByRole('button', { name: 'Delete gift', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Keyboard delete target' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Alex’s wishlist' })).toBeVisible()

    const overflow = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(overflow.width, `horizontal overflow: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.viewport)
    const expectedFailures = [
      { status: 409, suffix: `/api/items/${birthdayId}/purchase/` },
      { status: 503, suffix: `/api/items/${deleteId}/` },
      { status: 403, suffix: `/api/items/${deleteId}/` },
    ]
    for (const expected of expectedFailures) {
      expect(failedResponses.filter((response) => response.status === expected.status && response.url.endsWith(expected.suffix))).toHaveLength(1)
    }
    expect(failedResponses.filter((response) => !expectedFailures.some((expected) =>
      expected.status === response.status && response.url.endsWith(expected.suffix)))).toEqual([])
    const consoleStatusCounts = new Map(expectedFailures.map(({ status }) => [status, 1]))
    const unexpectedConsoleErrors: string[] = []
    for (const message of consoleErrors) {
      const status = message.match(/^Failed to load resource: the server responded with a status of (\d+) \(/)?.[1]
      const remaining = status ? consoleStatusCounts.get(Number(status)) ?? 0 : 0
      if (remaining > 0) consoleStatusCounts.set(Number(status), remaining - 1)
      else unexpectedConsoleErrors.push(message)
    }
    expect(pageErrors, `uncaught browser errors: ${pageErrors.join('\n')}`).toEqual([])
    expect(unexpectedConsoleErrors, `unexpected browser console errors: ${unexpectedConsoleErrors.join('\n')}`).toEqual([])
  } finally {
    await context?.close()
    await secondContext?.close()
    await robinContext?.close()
    await identityRaceContext?.close()
    if (server.pid) {
      let forceOwnedGroupCleanup = requiresOwnedGroupCleanup(server.exitCode, false)
      if (server.exitCode === null) {
        process.kill(server.pid, 'SIGTERM')
        await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 30_000))])
        forceOwnedGroupCleanup = requiresOwnedGroupCleanup(server.exitCode, server.exitCode === null)
      }
      // All fixture children inherit this detached, harness-owned process group.
      // If graceful supervisor cleanup exceeds its bounded allowance, kill only
      // that group, never a port owner or any unrelated server.
      if (forceOwnedGroupCleanup) {
        await killOwnedProcessGroup(server.pid)
        if (server.exitCode === null) {
          await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))])
        }
      }
    }
  }
})

async function chooseAndOpen(page: Page, url: string, name: string) {
  await page.goto(url)
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'Family wishlists' }).click()
  await page.getByRole('button', { name: 'View Alex’s wishlist' }).click()
}

function giftCard(page: Page, name: string) {
  return page.locator('article.gift-card').filter({ has: page.getByRole('heading', { name, exact: true }) })
}

async function visibleIdentityName(page: Page): Promise<string | null> {
  const name = page.locator('.current-identity strong')
  if (!await name.isVisible().catch(() => false)) return null
  return name.textContent()
}

async function waitForRenderedFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }))
}

function auditPage(page: Page, pageErrors: string[], consoleErrors: string[], failedResponses: Array<{ status: number; url: string }>) {
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() })
  })
}

async function killOwnedProcessGroup(processGroup: number) {
  try {
    process.kill(-processGroup, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw error
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(-processGroup, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Owned E2E process group ${processGroup} remained after SIGKILL`)
}

function readLines(process: ChildProcessWithoutNullStreams, output: string[]): AsyncIterable<string> {
  const queue: string[] = []
  let wake: (() => void) | undefined
  let remainder = ''
  let ended = false
  process.stdout.on('data', (chunk: Buffer) => {
    remainder += chunk.toString()
    const lines = remainder.split('\n')
    remainder = lines.pop() ?? ''
    output.push(...lines.filter(Boolean))
    queue.push(...lines.filter(Boolean))
    wake?.()
  })
  process.stdout.on('end', () => { ended = true; wake?.() })
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length) yield queue.shift()!
        else if (ended) return
        else await new Promise<void>((resolve) => { wake = resolve })
      }
    },
  }
}

async function nextJson<T>(lines: AsyncIterable<string>, process: ChildProcessWithoutNullStreams, stderr: string[]): Promise<T> {
  for await (const line of lines) {
    try { return JSON.parse(line) as T } catch { /* server logs can precede READY */ }
  }
  if (process.exitCode === null) await once(process, 'exit')
  throw new Error(`e2e server exited ${process.exitCode}: ${stderr.join('')}`)
}

async function waitForLine(lines: AsyncIterable<string>, process: ChildProcessWithoutNullStreams, stderr: string[], expected: string) {
  for await (const line of lines) {
    if (line === expected) return
  }
  if (process.exitCode === null) await once(process, 'exit')
  throw new Error(`e2e server exited ${process.exitCode}: ${stderr.join('')}`)
}
