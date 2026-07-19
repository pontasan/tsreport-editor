import {
    ExpressionLanguageError,
    evaluateExpressionAst,
    parseExpressionSource,
    type ExpressionAstNode,
} from 'tsreport-core'

export type StaticStringExpressionResolution =
    | { ok: true, value: string }
    | { ok: false, message: string }

function isStaticExpressionAst(ast: ExpressionAstNode): boolean {
    switch (ast.type) {
        case 'literal':
            return true
        case 'identifier':
        case 'member':
            return false
        case 'unary':
            return isStaticExpressionAst(ast.argument)
        case 'binary':
            return isStaticExpressionAst(ast.left) && isStaticExpressionAst(ast.right)
        case 'conditional':
            return isStaticExpressionAst(ast.test)
                && isStaticExpressionAst(ast.consequent)
                && isStaticExpressionAst(ast.alternate)
        case 'call':
            if (ast.callee.type !== 'identifier') return false
            for (let i = 0; i < ast.arguments.length; i++) {
                if (!isStaticExpressionAst(ast.arguments[i]!)) return false
            }
            return true
        case 'template':
            for (let i = 0; i < ast.parts.length; i++) {
                const part = ast.parts[i]
                if (part.type === 'expression' && !isStaticExpressionAst(part.expression)) return false
            }
            return true
    }
}

export function resolveStaticStringExpression(expression: string): StaticStringExpressionResolution {
    if (expression.trim() === '') {
        return { ok: false, message: 'テンプレート式が空です。' }
    }

    try {
        const parsed = parseExpressionSource(expression)
        if (!isStaticExpressionAst(parsed.ast)) {
            return { ok: false, message: 'サブレポートのテンプレート式は、設計時に確定する文字列式のみ指定できます。' }
        }
        const value = evaluateExpressionAst(parsed.ast, Object.create(null) as Record<string, unknown>)
        if (typeof value !== 'string') {
            return { ok: false, message: 'サブレポートのテンプレート式は文字列を返す必要があります。' }
        }
        if (value.trim() === '') {
            return { ok: false, message: 'サブレポートのテンプレート式は空文字を返せません。' }
        }
        return { ok: true, value }
    } catch (error) {
        if (error instanceof ExpressionLanguageError) {
            return { ok: false, message: error.message }
        }
        throw error
    }
}
