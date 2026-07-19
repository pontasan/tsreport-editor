// Runs once per server process at boot. First-boot initialization is
// serialized through a DB advisory lock, so the pm2 cluster (multiple
// processes) seeds the initial environment exactly once.
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('tsreport-core/node')
        const { SystemInitLogic } = await import('@/lib/server/logic/system_init_logic')
        await SystemInitLogic.ensureInitialized(SystemInitLogic.defaultContext())
        // Start the dedicated MCP listener (mcp.enabled / mcp.port) and keep it
        // in sync with administrator setting changes.
        const { McpServerLogic } = await import('@/lib/server/logic/mcp_server_logic')
        await McpServerLogic.syncListener()
        const { WorkspaceActivityLogic } = await import('@/lib/server/logic/workspace_activity_logic')
        await WorkspaceActivityLogic.startWebSocketServer()
    }
}
