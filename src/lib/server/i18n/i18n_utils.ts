import 'server-only'
import { getClientCatalog } from './dictionaries/client/catalog'
import { ClientDictionaryType } from './dictionaries/client/type'

export namespace I18NUtils {

    // Internationalization is implemented based on the following URL.
    // The original dynamically loads dictionaries via import, but here we link them statically.
    // Dynamic loading may become worthwhile if the constants grow too large; for now we're watching how much impact that would have.
    // https://nextjs.org/docs/app/guides/internationalization

    export const getClientDictionary = async (locale: string): Promise<ClientDictionaryType> => {
        return getClientCatalog(locale)
    }

}
