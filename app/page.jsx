'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SB } from '@/lib/supabase';
import { SBQ } from '@/lib/supabaseQuotes';
import Quotes from '@/app/quotes';
import Codes from '@/app/codes';
import Testing from '@/app/testing';
import Pricing from '@/app/pricing';
import Programs from '@/app/programs';
import { FilterSelect } from '@/app/components/FilterSelect';
import { SizeGrid, sizesForSelection, toScaleList, skuToken } from '@/app/components/SizeGrid';
// A backdrop click used to discard everything typed into these modals. Same
// treatment quotes.jsx got: card ref, onClose becomes guardedClose. All sixteen
// modals in this file are wired, so none is left behind on the old behaviour.
import { useDirtyGuard } from '@/app/components/ModalGuard';
// The RFQ sheet geometry and its builder, shared with app/api/rfq/send/route.js.
// The row numbers are a wire format between the workbook this writes and the one
// ImportBidsModal parses back -- a second copy would be a second chance to drift.
import { RFQ_ID_ROW, RFQ_SIZES, RFQ_DEST_ROWS, RFQ_ACC_ROWS, RFQ_NAME_ROW, RFQ_EMAIL_ROW, RFQ_VALID_ROW, RFQ_NOTES_ROW, buildRfqWorkbook, rfqFileName } from '@/lib/rfqSheet';

const LOGO_WHITE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAB3CAYAAACTxfGrAABdIElEQVR42u19d5hkRdX+e7p7ZnaXXVhgyWFBgoQPJaiIARQUA0HBgKIgKJ+gYsCIWfzMCX8qCoqCCqgoGFFAEQMgkpEsknPaAOzuhO5+f3/UOdOna+7tvt3TE63zPPfpme5761Y89daJQKJEiRIlSpQoUaJEiRIlSpQoUaJEiWYvyUysNEnRunO0ISJMw5koUaJEiRIlStSeSjMStQawRwWBMlOBbKJEiRIlSpQoUQKAHeJABYFlOElgokSJEiVKlChRotkLAEsqCdwdwKsAgGRZ1cOJEiVKlChRokSJZgsAJCkRyHs2gDfo3xW7Jw1tokSJEiVKlChRNlVmQRv2ArCYZD+AEUTOIYkSJUqUKFGiRIkmmUwa1wupnEn/SJb0c22S95Kskdxe76kkCWCiRIkSJUqUKFE+TbgKWETYKxCoNn+Chv3f0wGsr+14od3WK+CaoW5OlChRokSJEiVKALANeCqRLLn3jErvxgEC6w7k7YXgBQwAL3UAsFegTQCUtQ2JEiVKlChRokQJABbDa1IXkRqCvWHZAatugWUJQF1B5MvtJwDbkVwTDTvAcQFY6x8RqSroTJQoUaJEiRIlSgCwBeqjll0nuQHJLUSkCZiNQwooCii3A7Clgr8agM0B7Gbv7kZ96wAmAPSJSJXk6iTXHmedEyVKlChRokSJZjcAjIDgXAA/IbmHiAxDpYDeNrDD8uyZlwCYjyDxM6/fV2fc32md6wr+hkluDeAfCLaGQMo4kihRokSJEiVKlE3O/s/i8p1HcoTkG/T/il6lIjaBkU1hmWQfycsYaESvOsn7SK6j95b98wXrXCbZp//vSvIeLbO/aDmJEiVKlChRokT/7SCwXz/fwQZ9VH8vud+LAjQDYi/X0C8j0UWS73Ugs633sbunYupfkkeRXKblnRCXlyhRokSJEiVKlCgfsJkEcEeSVQfSfkFykf42YOAqC2BF0r+KSuku1XKGHbA0KeBdJOeatDAqQzwozJBUlkh+Wcur6/UaA4BpVBMlSpQoUaJEiVqDv5IL2NxP8goFVKsUYF1H8tnumUyJnQNqppp9jwN/VQV8/1GJ4KD+9mW9ty8H9IlT+RpI3JLkha7sGsnHSW4Y1ylRokSJEiVKlChRazBowO14BYBDelE/P0Jyvt5TdlI+b/M3oL/vQHJlBPaOJrm3/r3SSRlNcjfHlVtxksSKA4VvInm/PjfoJIt/8JlH0mgmSpQoUaJEiRIVA4AGtF4ZSde83d6/SO6X9ayzy9uM5L8dcCTJaxx4PEu/W6WSwcdJ7uHKGhPQmeTuJC9wamSrmwHAYw3EJgCYKFGiRIkSJUpUHAAagFtMcqlKAav6OewkeST5Z5JHkNzcOXzMJ7kvyZsdwDMAubPeI1r+fZFt4HKShzl7w4re91qSv3XvHdJ61LRuVf1+d9+GRIkSJUqUKFGiRAUBoLMDvNQ5bNQiAOYdOpZrmJc/q3Qw6763afn9zo7vBaoG9lJCkrxd7fsuJvmY+77qbBL9d1QJ4roJACZKlChRokSJEnUOAL038JnOzq5O8tdOamffD0bgkBmSwo858GcSRrM1PNCBxMEICPr3rHT/LyX5E5JPuHf/zQHLBAATJUqUKFGiRIm6BIAfcc4aVPXsBhp65e4MoFaP/n+U5JFaViXyNvZBnPcmeWubsqy8k9QD+HmRc8mp9p40iokSJUqUKFGi2USVLMCGkPKM3aRSi0lTvlk59+qnSdS2EZFTAXyA5BcAvBTAPgip19YE0A9gCMD9AH4L4IcicpeCsrrW05wzBECVZL+InE9yVwAHAjgUIU/wPABVAEsB3ALg9wDOF5E7tN27a72qAAYAPGZ1JSm96AvnSNKz/k2UKFGiRIkSJeoaABo4UVBCVX/Wou/HS0uj/xdq+QMi8hiA0wGcrpK89RSIrRKR+109KyJSdWDK5weGgsCKiCwBcDKAk0muA2B1AMMAHhGRQVfePACDCHmF4cq6z5XfNdiLch6XRKSm/Zu8ihMlSpQoUaJEUwMAnXRLFJhsCOAxERnS+Hsj3YKgDFoSgawFCpBG1M5OAmaSETSkhQamygDqIlL1gFR/o4jU9X8ocC0hSPQoIo8AeMSVV9Z31QEMi0id5GoG0vRzhd3eKfj1UlT9uwSgon06B8BGAO5wdU+SwESJEiVKlCjRpJF3bigpENkSwOUkdxWRIQUy5QjcdAqGjFZFAND/RhGpmXTP2faVFPBVDeR5isGTiFAvA4v1uDx7D5qlhzEIG8yoY6dkfVdS8LcFgAsA7KdtSfaFiRIlSpQoUaLJB4AOQNVVGvg3BS5/IvlxA19xqrYiQDCyeQOANexd+vlkFpBzAM6ulhKyVr9HgLDuQWT03GD06IJx9i0RpH5VERkheTCAqwBsi6CWFgC1NAUTJUqUKFGiRJMOAGPAon+fgWAT92kAvyO5nale0aE00KmXgaD69PRQBBCnghiBUcZ17QTsOnV1WUSGSa5L8nQE+8bVERxZntS+rqcpmChRokSJEiWafPTTAC4lF/fuKRoTz+LpLSP5QZedo+LCsEirOHlRGJivRWFgDrfyprD9FkdwC40HaHEAf+36pdSuD12+4T73/RtJ3uuCX1dJvlB/K6fZlyhRokSJEiWaciCoIMZA4K9c6jWjy0m+wD3T51XDLcot6b1XusDOIxqqZcoAoAevJNcj+bCLGbhMv/MAVnLKqRg41v93cLmJ6WIL3kRywAHn5AmcKFGiRIkSJZpSAGhOEiblOySSXA25/08nuWMEgCoKIEse4LjyXqLSNSvnBpLz2kkQs0DbRLRdP3+j4M8A27v0+zkOyEok8fMq8aeQ/KKTcBrQtTZ/zgHnBP4SJUqUKFGiRFMOACWSdi3STBmWH7emgKbm1LgnkdwloxwDR1bWJprTt+4kisc58Chd1lXG22YDZPr5Ziexq5F8iOTWDiCX9ZKonK1Jfp7kI06COOzAs4HKXfT+cgKAiRIlSpQoUaLpBgZNDfxjBTRDCmQMDPo8uiMkzyV5JMmdIlWokHwGyaudRKymwHJDL1XrAgDGksauAKErq6ySvmsjte2NJPeJJH1lktuQfIPmM17u+mOV9gkjyemf3bOlBAATJUqUKFGiRFNFuTZtGvplX4QUbDUEj+FhfaYfwVt2UP82cDQM4N8AViJ4uA4A2E4/R/SePgBHi8gJLqUbfWDnrLAuLriyv+w+Ru2hfZcVOzCn7IqGa9kLwHn6U03bBwDXa7sEwBwAixG8eo1WIXj29rn/+10Zbwdwov4+koI/J0qUKFGiRImmFTnV6IDa6pk0a5Dk+0n+0EkETeq10nkNe6o6aRpJflnL7vMBmv273fejdoXjaIupbftM9ZolLYzU3x9w9V2R0y5TZ6+Kvv8zyf9VJxK77wmSm1p90gxLlChRokSJEk0lZXrfanq2fs1e8SsEKd4QgHkA1hWRN5H8NoBDAOwHYNOoiCqCZK8PGhMPIQ3cZwEcb3mG0ZDkwaVMs/RoNbg4eZqzd2MA6wBYG8CaCIGlBxCkfcMIsfyWAngMIfXb/SKyXIuoaTmjKeJIeumgIATDrojIl0neD+AL+k64MkyiZ5JAAHgUwLkATheRc0keonVbqX12vojcre1Osf8SJUqUKFGiRFNKeSpgQcgSUiO5E4ArFbiUEXL07iAiy/TedQE8T4HgtggBlNdT8LcMwB0ALgTwTRG5Ux0uiEYWjFHgpzmArQ6LAewC4BkAngVgMwV+Cwu27QkFnfdq/S8FcLWI3Oze0a/tqqNZjVxWdfA6CKrblwLYQsEnADwA4EEANwH4A4C/isg9WmYfgEu07kMKEg8TkR/q+5L6N1GiRIkSJUo0/QCgAhmvdr0IwG4KaPoBvArArwHMEZGV7pkKgHUR0qj1I0jkHhSRVe53A1slBZQjzv5vawDPAXAogKcp4BtTNQWPdTgJovu+hCDZLOWAwhu17n8QkWtc3fsiIFg2QKqSuw0UfFKB7SMiMuyeH0CQfO4E4HL9u6IAdHsRedzlNU5SwESJEiVKlCjR9KHIBm9Av/twlMHjVwaaXMiXgSzPVi2rz2UOKUUetRWS+2rg5KWRPd2IC6diIVWG1a7O2+LVM57zz/hYfHRt+QvJw0iu4YGg89StkOxv0y6730LJfF7rs0Lf803XTkkewIkSJUqUKFGi6QwAxYWDWayODAa2nvRODRFoLLmwKnFw6LJztBggebjLDuKdLoY0XEzNvbPqwquQ5MUuTqHV6WLncGL32/NW3oiCv5or6y6SH1eVrwd3cd39NSb8TIbTDEnu7oBlyv6RKFGiRIkSJZoRgNBA4NnO87VO8p0e2GSAx5LLsBFL/Q4keY0DYEMZ3rQrHWirOUB1Ack9tczL3f33aeq27dVL2UsDPZisRSnaVkVlHO0kn31x0Oa4rfq3gdo9XbxDy3YykIBfokSJEiVKlGimAUADNwdFAZIvdOBOMq6SU6NaGdu6HMNZAGwZyZNVGveoy6hRV5B4dAQkr3bPPkRyY/fbq0jeH6mE6ySPJ/k5BXt0gM0Ht76E5HMz+mBM6Jjo9+86KSZJftaD5AQCEyVKlChRokQzBQCaFG9tkg86adwgye08AIpAUcns4vT/95Fc4gCZjw14q9oZLtZ7L48kaStI7q+/lZ093VWujAdJbhTZLm5H8j9OyljX/9fV9rw1UkGvjHIef43k6tbGHFtA65+1XOw/y3m8o9U5zaREiRIlSpQo0UwCgD5A8g8dIKu7fL79GRJAc4pYn+QvIqmfqWFvJ/luA1l6v08/N6wSwv3ce7xq+eoIAG7oQGK//r0tyXtcmST5T/e+OSQPJXlzTh0vJbllHgh0fXO4y/lLkn90QDhJ/hIlSpQoUaJEMxYAviRSA18R5dI1ta+Br50dsBqOpGvf0RiCcM8d4ICaOXwcYeDP10k/r4kA4AYOAHpJ4O7OI9jq8KEIwM0n+UGSj7j6rnJlv0rv64tsAu3570fq36PieidKlChRokSJEs00ECgqgbtGJV1LSe5mANGBLgN/+zgv3UGnzr3SPGP1vjn6/EJVz/rUcT/IAV1FAaCXBB7rgF2V5HKSW/k6633bkfyjU+V6G0VzfKl4T2n9fCrJO/W+5WaPmNS/iabTGk490cxDEiVKNHVrL63DGTJYTqX7GQU5r3bgrBTFwjvMSfAGXZy+r5JcTe/pVyBlz3wouv92kuv40DFtAOBDEQD0+YQNoF7scheT5A8doCtHQPAjTlo46NpzbAQyvYR0R733V67cUppFaZOf6rplOWpNt77yHvYJEM8IgYBMZD/2qty8Ok6n8Z/MukzW+prq+ZOoPUkHA1oRkSrJZwHYT0Q+roCpipAdo6Lp094E4FSErBrDCKnQagDeJiLf08G2XMD2uRFCura10ci1e6iI/FjBVc2nTyMpmq/4GgBP168fArCziNyvoIuufSWt+64A/oaQocMyiTwLwNX6ndWprmnwXgjgNAAbalssy8hHReRzVjd9h7X/f7VPTtV7q9Mp9Zv2jaCR8aTl7S3myejzcfsc6KV7VymjzKw6MB7rTuZpxvz2dYCI1MdZJl3mGulkbHPey+g7/39TvTt5j69jNIZ+/Bm902fVaXrfRMxht47Hc0ga039F6tpiDrQaD/ixGMc8Yrf92UG9/fcl5WksyANYoF32e13HcDxramzhBee7yyGPnPnMaF6P9r+rc/z7eOZfN89n9St7wPda8mvjDRO9PzkeVMpoH91vdc+XuuWzBfa/ckbfx31d7XXfRPsixjNvJj2bWJzFwiRgJs3Tz1e4uHsmPXuA5MuctDDLVvDjkf3cxU4qJy3Cr1yT4wRSyqi3veu06F1neGldhup4O5K3OMmhqbLfG0lASy5mYmk6nWx8aJ5eg8leO7m4OTUh/eediMbxvA8MXira/z1af6Wi6zTKZlPq4p1ll8WnNFHjMZESqha/l8db/jieL0+Fc9h4291qvk3UGE7E3Jlujnnx3jORh3/bC907yxPMayudtskiiESJJWSy52kc4m66S10nRAIYoXdD7SUn+Sqr5GsXAH8EsCZCzuABAPcA2EdErlNAVYvQbx3A6ir9e4qi7j4A+4rIOaoeHoPEcySADwPYUUQeIFkWkVrUhn4RGVIJ5l/RyBe8CsBOInKrk+hZm/v0mU0B/B7A9gAGtY5lAIeJyA+1bSO+n6Zbvl8nFd0QwFytb1XrW2RhxLmWVwB4xE5xdqLWzzUALNLxrblTXTmSCFpO57JeywAs9SdVHZON3f01d4JrVVc/R0s6Zg8h5KcWhNzOc3SuFmFQZQArReRBJ0GBl6y0WTt1hBzZ66k02eZ/3a0pq/eoVF2v5QCWuL6ut5GmiZP61FxdNtM5/FQAW2hd5mk/Ldf1eiuA/wC4SUQe9puU/lnrxanY1VcArKZ1qem8tPlQa8GjbB5V3f0AcK/yI8mRTpvEp6JroaLlDLu56N9pfV3R76vaT6J1nqN1LrkxzKtrCcAqnUMVHZ96h/21AMA6rm9sDVXcPBOtk7g59ITySAGwhvLpqt7fqu4x2Xv7dc48pv+vpeUO6vuKSuY9DzDpzCNa30wJTLSZroaQf77mJNelSOJtfKhP1/tDquGZr2NYde0qFah3PUfKJhn8shxJ3WM+9YDjU7bmN3Jzr5bRn5IhRaK7JHp+CMAKERnK6Mt+W0e9lLgp6KOTlq8FYBcATwOwDYCFOn/WBnAvgNsAXA/gOhF5KKpfrRWf7XD/2wHAC914+74St3bOjHgue8DrNtC9t+b2Ur9m8+ac3yf6dCwf6gUuqHTSjqizRjcrdXj4RQT+7gfwUhG5Ub1xR+LFr52yv25G9txlAM7XCVRDcXVlK7E6tJ4VEbmM5NkADgawUhnImwB8LAINADBCsk9E7lYp5h90Ax3Sen2L5HUicpUDj9MK+DkyNfjJAHbVtq6hgKiecyBgBKgWKGOuArgcwRRg2DHkio7z6wF8Vvtjjm4WA7rgvYh9rv6+XOvwAxH5oPalMdD1AFyi987VBfBkDsON/57jABQAfEhETg5rkh8BcKjWbVXEDLLaXwNQIvkeB/qrBfu+rBvOPgBO0E1ynvbJHP1/yM11a+cy/f9KAPu6NZSlEqBTh9X0faIOVy8F8GIAOzowcLkyXnvHIgCHaX8DwMMkrwRwPoBzRORWJ72q9wgEmlnJXgB+oPVYqHNhhRvjUgYfogMAdW1TXdt5jQOQMXCo6LjtjYapSsXNxUG9yvrbHB2LJ7S8+wA8Q+vw/3RcylpfDzziuWQM/AmSrxORi/SAW483irz1q+//KIAjtA3zXP2WO/BDPVgbsC8BOFNE3qZz//MAXqPfL9S6j7h+zlsHJQDzATyuZV8B4OX69/8D8Erti1XufrRYq1bf1bUOT2pbjhKRnysfqLZYU1WSRwP4gJY1T8exquWJe8cC/e5GXQ/LAHwQwDtcPwxF6zBrDKE8o9Sin8QdlKHtGnZg0AO1N4vIWSTniMggyY0AXKRtmeeANjLAqedPHmgasOjXOi/TefewHu6uB3AVgH+IyHInhax3KrjIMTcpuYPnywC8DsA+CvaWA7hU15Hx5p0BvF3r/DjJv6vA5WwRedDVbzyHT9v/VgPw9QL3V9VkbQwf6ULyZ/Pp+7r3lnXvXalztZVZkI3tam7vvYTkK2w+jocXSweNQCTt8aea3wN4iS6eijLQl4jIxSbFy7ATsWfPVaY9qMzscBE5VZ8blRh2KAEs+YkcAZQqgOcCuNB9d5tKAZ/QAY9PeGbf9xQAfwawWBd0P4CbAewO4FG3aWA6SQCj8VtbmeRWOmaHqUShHa0E8D2V8t6ik/HReBLquxboBLfT+ea6Ubw2YvwP6qL4PYC79B3LMiSA6+rhYmfduPYr2PTrAJwC4GJlOI87YLFA++B9yqCK0uN6sPmHAZhWm7eXRKnEYQ1t+/oAtgSwG4BXq0TS6CoAPwfwdwVpgwAe9VLtnBOuKPAraV+/HcBznHTsagCfAXCeiKzIkQY8B8B7ALzC/fQkgN8A+LaIXOxP1OOxZXM8YZ5uwOvp2jxUQVYROhfAz7TPHtNrOI9vRGOx0EnyttGxOCAai+sB/EgPIaNj4SS6zwbwfuVhReleADtpXUt+DbWbR1pnOzysr+U8S8d7jts8/qiH8stVorZKJRpQad18nX8vAHCUHgDa0SoAPwXwSwA36Lx4TOu/CMDWOpff00FfrND+/a3y0iEAy0RkZUF12up6ranvXwzgELcv2GHzmwB+otLbRxUMrKnPbqZj/zYAmxao80cVSFXQbEvr+ewC1VzsoH28Rs4mf4yIfJ3kgGqb+pTfLeyQ310I4IvKc/t1zW+p62hv/S6m+wH8GsApInK5k9zVO7Vt9phAedDzABwHYE+97VFdJ7/I4T12AP2g248eAnC68p3bvA1dp3zHDsdat98DeFGONskkrheKyN4OD3QFtCI+t0jHZys9hByu87YdPQngZADnqYbmcV13nBL/gijQ88eiUC91km+0DSVL9+5s5bZXuzoLunyvZtSQVnr/Al7ApTZ1L5G8LAoOva87aUj0Ht/enTTMiw9Xc1rU3mmp78/xhNvPxUisZVyWQu/dBedFK++vB91Y/5rkJm3GN2/8z3JBty3Hc91lqamp7el6RfqB5OtJPhG115drl+WjvksDnEtemsBW9c+4bxOS1+k7LyE5p8O1WHG2k3uSvMiti5r20weiNIpmC9RntrlRuQdpTEzf7hrJU7XtY7zzu+QjWf02n+QdbjziMR7Wzz9PwBrZjORN2uYbdGMqMoe+4MJMjUQ5yH0ecuMZ5zj7ynI7+68Ca+uFGpqrZvyo6HzU3OzDrl9r0Zy3LErvL8hT3hmNU9Zle8Xbup03LdqzQJME1Eg+SfKAgvV+rtqGGz+s51xbdVjfTUl+JUpLatEuPqX39LVozy+jtKj+su++3+L9W7o4tZZ+tep4RJXkKSQ3a1eXVmPheND7o/Kv9X2m5Xve4232n0Lyb/qcRQ9ZomHcmuwWu5gzxqvf5NodU93tLdvHmKCXc1XT1VYzeFxdv7N1d1S3e8tEAQnryGdq+rSqc474PweGmow43WXPHxuFZTnRd3iLy8qLAeCGUWw+aZGh5D3u3aMLKCvkjCtzjn73Fsfsrd2v9yBwmqqB4doyoP28tsuLXMtZDCT5P/rc3HbgPMoFbaB4FwVZJPkVL3WKDZHjOFEu/d88LfNtrv9rUX2rUSaWgdiQOHKQsPmwj24WnvFk9YOFA/qtY2CdMMvYQWOu/vZeLfddDgT15zl++Hmp/88l+WVXZ59J5zVOfZvp0OHXR7S+78twgDrQGHkvDiTRfLHg7adF/e3Hwr77hD47zznldDoW9ly/C1F1tJb/cf1/XuTA1nQwdP31oWhe1qP5U48c5L4ZzVFpd5jIyLPe5/jS6Vrus/W+OVlG9Bkhshbq4Sxr7lcdEN/B8Y5y5LA16nDkQAsdkIrJxvAV+tycToz9I55edrxmnv5+jpZ/vP4/J2f8yq4fSyRvbAEOjJ4ROUiVo6vinK98OtS3KsCsuj3vEx50Rfxzrv59tOuzrPGhZtAqOwePrPe/Tt9v4znsQAY1Y9aLO1nbGXzoW1G616Ukn+bGQLKc56K1v4DkeS49q83LRY6PdQMAbYzb7XnG5z41Xj4X72vOwaWiB+kHcupRdd9tl7XuekGlLpk2tVOOdzYXfQghVj6tk2FE1aA0UaUTV5qaah+z59DPs7yIt8VlIurY7sveUc971tmU/E5VjgMqin8xyYUAxJ9O0DCiNiY/T0S+r6rFPlfe53SC1rSM6en1o/2DYCdWVbXOigKPjqgKcqSV6NmPkYrch1X9cZKqnY4Tkfe7/h0RkZqfH75s/d6MZm1OLXPzVyKTBnt2qY5BVeeLV2uUnLi/puqXc1QkvyJS61i54uwxhhFsv74kIiMACjEkP3f1s4pgm1pCw67xHi1r2EwgsswJtC0VVWlsgmCr9359xuxKKgCOVnsqM/auRX0Rl1kFUNc+uVxVwY+hETrJO3KxB3PRPq2dNW3/Y9HazjJdedyp+NhJfdwctasKYEjH4h697QmtS037ranvXH9RbYW/COBLyhfqGepBm0NminI0yYPVOL+cI1mUuK/cfK5qOcZPb9fHlrs1G89933bjAStV9QrkhweqAnhS12LVtQ+OF9e0LwTAV9Ac/ilWf9o7dtM61LoYP8/vbQxXqXp/K1XXn6R9M2L3xfPO5oCWMezMVPLInKtqIlLVeeGvqrZpRMemouvpu6oeL7VrkxsfOt6QZXcIt2fWlN9Vo7nRR7JfRH6Khs2jhWMz2/VhVVmfTXJvNXkq6r1rNs4f1vJHtP8GAJwqIv9yfgCCbOcnKi8cEJEnALxBTXi8TWdftP471TLYeC9za4UtcNEb9HBV69YTOWNfs3VS0733yRY8jo1iRvfe+nj5blcA0HVkRStzqNrrDKNhsH6kboglBIN586iT6HnqAt0RDe+sWwFcGocByZH+ZW241HeKfeYEnCypl/B/EIyYzetnE4Q4giMiMqyf/hoSkUGzTRGRNyMY58/VPtgMwcmgpgM2bWL/tQCB6JTxFrE7cCfCmkpVzkTwAPu0iHzKGb9XO6w62zDnJkeljEMC3POMGE9JRH6ujKGUUzdxjHMYwHtIvlGZbaVb0bwyw3Jc7zY2f2aXujmCvdfz0Oxd3Afg+yLyffNSzwN+GfYtBDCszPgKAO9Cw96p3EsGlPH+rPmVB/L9GLObejkG7eMtjriNjWjv1e/jAp4Y1ZPR5uPtxGoATiT5HDtIdKniGQUMxtdbzP2sPq+12VTF3TdmY4vKMvvefwD4S4v1am19uUrBu+ab3gFKn99W95c/iMjNbk2M2c+8kKLFnBuXoNsAloKw7yHYUc4p8L6aO+Cgi0NO3QMOPaScimDP623dy06YMR/AaerYWS8gbTPnij0QbP6qDlgCwE/dIaqO5hiMWX01rPV8FMEm00cFKHV68Iznk5sfz85Zp3D8f3MAuxt/7sWeHoHBeou9zDu/1fPW3XipUxse8/pdiOA1672PagBOLiAuFZI1BOPb+Q6ArIvgZduH1kEwPUPd0v29FoIh8RCyPTrjDbSO4G7vvQo/Q/IcjDXujTeesp4ul7rn6wDeSfJ7AG6NHVGmoza4S0bHgvOEegI8E8FA/lMicpx59nU6iZVpZNVdOmXaGaFBLJjtPFd2n2NmsQdjyTHmb5K8WUSu8GGLxjEeTaAiJ4yJgeuNdM4/FY1A5Qb+7gbwET1QFe7vyGliWIHmGep19tqonydDyi0tvmPRQ0mX86vdgcM7P9W0jDkRwKlH/MyH+zFHktNIPhPBScN4T51ktx5+nT5TL9DnpYLl1xHCZw2TPAkh5IYPz+LLryM4SeypYb8q6gXTjYG/p8P081Q3FvUcwNoz7VibtSQ6pgLg46pBWNDhe6TLOhjgMjD3/wDsn8E7y7p/rgPgsyLyJnPczJqLLqhyTdvUh+bQWw8DuFPXBTMA0Jh6muRa+c7FJH8M4M3R/On6gKBfHaT1vlUPCjVke1hX9N7zMTHRPej4hLSQAE6YMKnS4QIzL5r/VYlX1TGytVUi2An5MC+rd/G8p34Ejzh0wfxMvbWbXp0+b1LEAQSvrrd576EZQO1irXXCjEuuT3+G4P37GQV/fePsk4mWqtb0UHKjSgIt9Epf1Cd1d+hZCODnmmXmMYwNJdT1mOSFWHDz/TQ0whL5vhUA3xSRR/Q0PdJxR4/N1/lpBM+11ZEdSX82EHuw8Vpf/0bHZgvHJyUDDI6opOFkBA/a+IDDKVr/7HTtuY3WzBp+hxBh4SmRlFGcBLQE4J0AzhknkBc9FC3QfrwNwJ/sAGTzeCo0M24t1VSSdBvJEwAci4Z3LscxVp3wN6h09noA/4OGJ6w/+NYAvIrkZ0Xk31HGq2jIZVilf3u4A7ON6xNeelk0Q0/E876GoA7u9xLyouMYHQ5G9JD/FhU2/RXBc7qeAcRs7e1PciMRua+HQp1pwzdLHd5r0r+3o1mlUco5ObeiaiR+7WZi1zHW1oZdMA465j2CZpVS3lVzJ/mKO9kfQnKxisVLOSfUWUna3pIDf/sD+IKmDTTGUu8hE2aPF5MB18cRYq09EAErRBJjUwVvhmDjyB6Md+Y8jmxJqnrifgEaoZesXhWt96kmdej21OzUFBURuQEhrMhkMbCZumasv29UIDKY0WeMDuHDCDH0vuJMaDoBf5xG63/UzlHDfXy7xVgaz3whye1UQlbuZq6iof59OYI26ftqrlPUZGHC+jBW2+m6PEn/nTcpJ/zGWi6LyCoA12YcNvwcXg1Beos24wedu15rZt+v4QBuYe2M41tl5TvnKR8ujWOsbH48ByHM08kAfuz4eD0L7yCEbtmvC7w0I6jUweQxHfirdcPzuXwfQ7ABXIagFl3urmXR3/a7oDlo5RItZ4m7lmZcS9y9HkRWo9+XtHjWnn9MGTQdMx5s8W5/LdP7HkUj+n1VF877sqQ4sxj4iYsBVQXwHYR4al8SkQ+72FL1GdAXdQALNNL6wXqK9fYa8QmxTw8Nr9T21gD09SIdYIbKxYytdwPwITTsZ0totnP6ldrQlFrZERY8OXsV0ilOSjCTQdpkANe1ReQaAB9Bw9A+a7O16P5VBJvS1zoQOBMlqIykTT9BiOdWwdiMB6Y56QdwiAG5AingvFelRAedd+qh6Gxbz5HDyFTxx1gKeCdCwOf1pmh+3pKzhn1Woh3zpHfOrg8KquD4kI3HIgDbODWydMAXiYYz5VmITAiK8lU37nb/EQhOTxeKyAMIcUQlEiTFAqnR+LXTOczbhAFAJ9bvU/GpTeQSglfTYgQ7pK302hJB9bGF+3tLhGCrmwF4t5OeCEJg0U0QVAWb6t9512J33ewm7BKEKNub6juyytlUr8Van8UIGStKCuJET6yLtS6L3TPx5e/ZNxIjH0JyLd18Z92pIYepmHnAF3WOfEVEPuRSAtVmSFvMKURE5C8A3uvmahajtHU0DOB9uoEPI9hBjTedkkQ5gA2I/V+0oXrnlDqA30U2P+MFn7a5Xq7SxfkZQDFRs3RiRFVGxyPYXFlKqzybRttQv0dyx9gpZEYwgWYv1pracT2AEGwYGVIWbwN1qKaQrCoIzAWCGeuqLCJ1klsjBD7+nYjcYgfPqZyjXqLpQajW6TTke4FOlBTQ3rOkxTw0ALRRq3Wufb5QJa7x8/aed7r3eoBYZE8xgcFFCB6zc7rkoSUX+PtlCBlGluktP454aNO80vn4HD10c6atyXEDQOddVUfw5HyWdsoAgp3FqSKyQkQeFpHHWlyPAnhYRB5HsHnxDOFcFdc/oWWt1GtFxvWkXivcCcQm3eP63BM5z46WYe9CcDX3iH+x3rPc3tPisvddgGBPUNLT50IALxvvJjxDJH82P6okP4sQyf3rIvIBi482zZ1hMk/IqooY0NRx31DmU0W2uYKpXkcAfIfkLi6q/7gkgI55lrUfXwJgL4w1ijYGuwzApVHIo/FIAK3sioYruQbB4SpvM07UvEH2I6Qq+x2aw0bl8eLVAZyiuVPr7YKiT1e+0PiTAuBb2u4857ohBLXcy03bhAIewRlhnQ7WfemUeC1PUT/4A2LJeR5XdW2fBOAdkTRtoselyDzyzo5NUsIoqxQQ1LzzoudMq1cFcADJTzoBQLmTOuj77kLIPDO3y6ZbO/bT9XWaK/t8hCxR5ehA7Q+/AwBe4SWJs2VPL3V436vQMFwGNK2LC1jbMngzGk4nT3PlEsFrdhQsFbhKGZPZP9+2HCdG/heCSnpAy9nKZzApUBdTh50RLYyDdMLUZrGkRNDIyXkcgrrrGyJyjEn+MHMcYXJ4JssqBfylSnHimHNxjKm1APyIpOVi7ZUq2Ku4gIZjAaL6XCYiS1zy8/G801PdbeZXjce+8L+QagD+F8GxKNegXjehEQTV2/dNypzhkDPtJYEWL1YPDtepFDAGOjH/PsrN7SLZT0ZjFGq4qTcjpGi7QOd/baoPKAp86lkaEAWDw5gkU4pIArh6G75OAHcUKLaK/FzyNt6fIvkFBfUWraCSF9DYh4TS/aWGYHr2bzevOl1/QFD/LgVwoZbTJyKPIdgYeoEUM7DPa3SOzSqtXpGG2AIbQMgpCLcRnu06rmXwZpssCpg2deUsAXBXuwDOUTl59hx0cbvalWOT4n40EqZbaJmFUeBVFggsfQ6C27sZve5OcsPZqAZ2gN7A38cAfALACSLy7hmo9m3HOKiby21oDnXA6NRoEp7tAJzk4nCN69TobP+2UekfMdaD3+p0lT/19nADrCsD/72I/Mltbonaz6GSJrV/jW5AeeDZOxa9EsCHzabUAYYZIXF1wYyNvoP8OJIWpHw3kjshP4B0lpTRtFN7Ipj5fE9EBtGjuG3jZZX6uYjkD2xfiQD9uHJqd3loh/ZVDHZiG7grY2AXgTMgOMytynmPlwR+CMDfNOVqVWPr1uMMOwYKfZBuVeHeIyLL9bd6UY9iNJsHPB/AiQpCK64NP0BDoxLH6rSoDpsD2KOXMQFnjARQG7s9mt3GrwNwpQv7UbScRWgkWxcADyoIA7rz4PV/S+d8SoYB3OROM2sA2LCLDfpBAH/Xrwa1nD3ce2abqqysgYg/gmCTdqKIHK1q31HmP0PbLdEJvqI2IwfpgcVOtj5TQsl9jgB4HcnP2PP2e5dpfOyZ/REk1VmHCqvzv7tcS602cjqJaEkZclL9Fu/DqobjuQrAkW5TiTdfiSSBnyB5gNuwZqIquKYHwr8i2JAan61hbEzNPgCHx4f4NlIio7co3z3LZaua6r6ytm2DkGWokgWSJ2stuX4p6yE176BXVqHIH03SHwNX/b+sWTvuRn4w7dG4pQgh1n6LEJ7nIJKrKRA0ftaUDccHeTeQ2EX4FxuD1+nnGf5wpvz4n3pwtow3jACgrc23Wh/9N6mAbdK+EM3q3z/pwJULnmCsw9ZC8HyycparvVQvNpVOnvdG/P9xkx9OQlkovRcaapoLo3o8N2NCzlQw5D/7FPy9D8GJ5kca+7DJ5m8Gtzk+5doGfiWCGsHsWLIyUBgjqwL4MMn9dQPPs30pMmdN0rZHiwOQOYXcNYESna4zbiRCVZ0ifq5rJrYHlGgOmV3pD0hur04hlRkGvMUdFqsqafGHpTi4PgEcRHJ9tEi/lWF7vCWCcf9vROQ2ZIf1mEiemAdALE/4dmikW5t0EO77S+uxKYCnR/3ueU0JQZJ6r/WlSZ+j8bD986/Il2r7ey295Z4I2VAuI/kpktu49HVAUA+XPRC0NIxd7Ckjui+9AcDVInK9mQegoWKuIngax3PS150IWr1NMYvUwEUaYYOyS/T9pV2+c91ogf6nKNjq4aKIvZHujjbjzTusk53i/qLtMm+lXfWUVJ2h8yMrdllFg3++FyHf5wiAHdQbzIcMmckOAllpBmsk54jILwF83p1q2/XfqSSf7mx9OooVaMFHtX93zlm3dkIdQQi54efkRAHBRJ1JXvRP9onIxwCcngECPcC2w/ZCBKeQ1XUjnkmxRa0tFhP1dAS7siwPdpu/66JhP91uf7LfD0RQI5/agaNDLw+IeeNdd6HTJqNeeQKK0f7S/1+j86oWSf6GtB+vQLDb8/t0Fk+3v3+mz+bZHXsTGQNfNQXGnwRwBclfqHq4z0kFy1nt6cCm2lS1zwOwNYAf6fd9GJvl5ycIDnTx4cGvxTUB7D+b+F9bOwvdfOYgqH+BoIJ6XCcJMDa2U6sFATjXcqU7p2BRxDn4lkaToWMAqJ+362XPbY1GnKeZLg0zd/ohku8A8FXHQHYC8HnLgwwXp2mGSgGZ892QSnE+gqBK6Eez4bBXHdgmtyaCU8h8RLZN7iBSBIxuhWA+Ec8lv7EMIsSlLCpZTDT588pA3NEIpifmPV6PxtN7lj8TwMmmKpspIDCSGpc0+sIPWszPUW9eldpk7i2RTfk8BAebWwD8We+vTrBqtaL1q2j6Orv61Ma9gkY6vKcjaM8G0fsQIpnS+AyHRzu4j5BchJDbO5b6VVVwcReA12uEDLTIlQydy30icqOOq9mvtsqoYyphkxha7NxXIaiHLyZ5lB62LSSQFAV9Ofe8RdfRL1x73SMsi8hdCDnVEWGDWJX8+jbvmh0AMMqdtwghlp9JGu4GcE9Rj5xoIa4bMYCHpwIgRZ6VZoNoC3RuJ4Osp5KSRlg3I/wRhFyP285wAOhPj3WSRyJ4ghqINiPfo1TdOeqdOkmn8cncyIzplRHsQa5HIwA4I2kcnITnaQhOIbaBd7MRbIZ8D9LRDRHZBtmJpnj+RBt2SW1KX4VgA13CWE9Kb1s6jOCF+EFdX5WZtK6M1yo/+Cmas9fEVEXQNpmzU7mAdGdLBJXlkJNyTQh417+XqMpy2FSXeo24a1gdWn6GhknIRNQpzjAi0dwpA+hX8DeAkB95IzS8d82+tB8hPdpeIvIfPejWTPXbok/rCoY/AOBiFRANF8AFJVc/c6a0sf8Ognr41ar6pdtTShmYImutiZoHrIEQp/ccEbnXHSx8Hxq4/BmaTcNiKWAVwLNIPtcklDMdBFbagBr79ykIsX4sL+pNZgQKZ/BfUJKxdvT9gz1cDN0OhmUVsYFfM+Mk0O7UYSmd/uMAYJ9u3DbhZ7LX5HKSBwE40TEzHyeqDuAkklcgBAs2FemskUS5xOoVDX/0GgS7z/Wj+eODqdoGfjDJW0Tk08qI88LJSAajrKHhOMUWa6vwnM2Yv5KzhvLy0kor6WlSE2fyU9OoCMl+EbmJ5BEIMQItPEarGJP/R/ImEfmtxhccaTUG01D6WVZw8RMAh6ERGzCe6xWVQp1HMit8it+g36zStbMnODSRn//HkrwX2TmxqfvHYgC7I6hagUkIIKxzLGs/rpJ8KkI8073RcLiBE4B8GSGEV12lmNUC69gfaFbo/nA2QqzgOsZ61MZ7tf8sOelcDcAOCDnWT0EIJr0iUknn8jIXS7KOYBu6EMCPnVCr7tckGk4uFyBoJBfn1L2uQPlABbszns9VCqB0Mxq1wekDcLvvTBemQvIYn/tqYXTLYMbgTSZTAkK6ryEn+Vvdb6bt6mULT/+9PZo0GzeaN+PSwtnCXKGT/utoZDNgxBRrCoS+ISKvdoa2QnLWAALn2dgnIjeTfBMaMQLraDaqJpqdQj5G8nIR+YNjslJw016Qc9CJQVlR20LxoY7QPpc2i4CM/4bUhz2YP2YX1y8i55A8FsAXFNBJDsi2tIM/IrmriPxbpRm1jDkk063NkUDhGwDeiGYPSw8ECGB/kpuKyN0ZoVJMurMYwCsAnCUidxQBCD0AgRaTbig6APs5P4BGtpyJktgykhzbWjZJ6wBCJIotEWz+Dtd9zQD1SoTgyj8BcIaIPKSOF0Vsm2Ptjh2K7yP5YgDfBHCo2xeAsfaeWYdeny3E1sLhALbVDEv3+OwuWXzG4Q3DI0cieDSfr79V/Vyyean1X6aHkw873uzraON9IMlPAlhhNtozlR+1UwEbbRAN5n1odpGu54W3cBPFxKVrRZKKAWc3MWpHkXf5+zIWlX3fZJPRqiz9HHQncABYTaU0fbqx55U3+j0adiEPR+B6g24lM9NBcIFGzLkHXds8o46lFK8ieYylQ8PkxriaFEmOxX/UDfx8ZRhetRAzurLrox95r84WG0O8qc/N2dxjqQeLtsPZ1swjuRbJ+fr36iQXkFxDP7Ou1fX+ufq5tq6ZlB6u/dwxKc2IbjxfRJCs9zmpXgzmzNRgIYKzwzw0TDAkZ85MK+mnbsplEbkaIQODbfR1x1NM1bYmGvZWpWg/sf9fiWC3dmL0/URSGcALRGQ9AOuIyCIRWVs/F4nIIgDrIHjZHo9sr9Je8WZ/4NyP5LUkr0MIa3IxgGsR0qi9W8GfgapBBYW7isjxCv760AhYzYJZWPxlY/u4iLwJwD4ALtH6GXAaUQwR592NM7qU0HAYGQbwbAA/0zlf5IBjoGwzAC8A8BMRedJClLU54J6p86+cg5es3L2K5q6ekQAwSqC8ZtTxg9rBw2Zs6z6zrjqAES2zzy2kGoDb1GZiMLKhaHuhWQVSB/CI2V9k2GRkXcNazl1RWRURGdLfh/TerPK87ccqtc+5Bc1u4mvPgr1rAMDfENQtPgRKPQME1gB8muTOLvzJrNzM3Qb+DQAn6WFhBNlG0zbfFyGoI+YhPxjwqMS4oDROOpDqx4ySAI4DcJnO3dsQ4rVdod9dgRAQ9kr9+wr9/TIANyKoTK5GUIXvVNB7878eCEbBgCsIhvmXIj/bjGVSGkKIp3ayBaXFDLAHdIDC+MFJaHYIiNsKAG8kORcNTYwBREuxdxRC3Mt/YnJMbGKHgLxcxYMi8i8ReS+A92NsBpRekvGQR3T+XKRCh50RHBDN0cLba89HULFTD3B2uOhIgp+xz1vonrKI/B5BBf46BOcc6Nw2PlhDtnlJHGbGeOpuAL7kHA2L4Bo7QPzSC49UGNUkvNHv5gC4WXldVnxjX8+3TsfDVqdUKaCqABoqUeuU95I8QKV3flNqtWEJyREEj9E6Gq7YnyG5rMPOtLpt5oDIGipdWYnmFFlFqB9BxWZlbU3ytEii084WouTq4d9tqoCZKAnz7V6kqsszEHJuZsW2s01rPoBvk3yBSspmtJi8zUZugW7fjWAr+2KMtW3yINDWwHdE5E0WOzELzEVAYUWLdeadTlZH8NJvOWfN9kU/v4lgh7YJQq7hNxbsgn8jeP+Z3efNk5QijrNo/tSd9Pz1CqQ3QSPgfjzWfQoCX0/yChH5mh4mhjFNVcARWfDd8xG8oLdxB2ZvN1tDSD6wp6rJRyXsCjSepc++Qx0c+p2QYTL5Y9baKrk96BsIasztO9hPOnm/Sav+LiJH6vu/D+Afbs/2OZgNgL2R5B9F5Efadz1Jm+diwFZUIPIzld49V6WOr0Ej0UId7WPq+TofSfLHIvJPD1oz+FpVPw8GcLlqaYB8m9m4jG8g5AvOC9ROAM8juZmI3KnawOpM1HRVOpzotki30Wu8pxZB8NAZ7wlIEJxUXj3OTcUGeS2EwJHjKavmwOVssIEzMPJ2hADXfpPy88Ts3XYFcJyIfMiY9yy2DxMNj/MWBNVLVt/4NTcM4FC1B/xWQRXCo9FaZMbfAyphvLcdCLBxUHB+NxqxME8j+U/duLIcW+ywcyOAZ6nn+1SBvIkGOjKBE8bbXFYRtA53kjwEwJ/cATm2taU7SHxWnUL+MIPUUHVt66ButN+JNte4/9+NkGYzBodHI6gyfzGFealz1Yku+0ud5NkIkQDYwdzudI4O6EG0X0SuIHmC9l1sg2djQABfJflnBJOunnoqa/tHvXxF5GKEEC+fRbDbPBhBPWvA3of8yQpzZU6Vb1OJbx5ZetIXKOi+k+RZ0QGjVZiaugowvImb538WE3B1hMxM38AMzvRV6vI+drnwDfHLBC2C6ShhmMnqMN8PpuJfjhBXqYSxqhB/UKgCOIbknrogZ1wqq6IbubavLCL3IKg8TAIXe0F7JlIF8BWSL49MI2Ipjm1s96I5l6pkrK9+BEccoKBtim5QJVWHzFGm/VsFqWaHU3afNr7nicgqkgNmPN7jseUkr9MsflKfjPmDZqeQiwC8Dw2NQh1jnYrMdnQOgj3gYi2nMgPWitmLCYK91b1otp9FJGx4rmaKMElRleRauvmeLSIP67ysT8NN2OpzVcZhajSneidx7jLmqTjQWUMwSykhZJu5182jONWgmaOcaOZeLidvqWjMPb/u42dUGljVw39FeeQjInKyiOyJkNnoF+5gXEN2diU4vrc3yTUcwPR18f1hTiiDCOrjXRFsCe0z69pV790OQaWeZafoTVwONqeZ6b6v5cSGLBwGJt7EnnATWgouAlvg8x14qAO4FSF2mXQIDOsIwXEHnMTtNjQMXYsaRNuAPhUN1/FhLaueseFm2V/5CTKg9TIasQGY4Spgm0j9InIByeMBHKPtK+WcpPoB/JDkjgjBtgt5mM1QIGiewZeQfA+CatQi6yOS1NncH1CJ29YInmqtwM3NCJ57qyE7Q0tV37U1gHM7ORRZYHSSdQWEI1qfdZFv2vGoGfbrxjMV0reJOlyVJwsAOl4runn3i8gJJDdDsB8bQbPXvXcsquoYnU5yd0xBqrEu21tXFeESkqcC+JjjtYh45zwE2+MPopF//CDdR74VzeFpA3QjQPBvBRSVnP3U88zxrpM6gm3vIyQ/DuAUNNTEXqJl82cfkm8Vke+aKriDw5X4td/CKxfKJ+jtOEXk7wD+TnIvhHzyu7n9JGsPpx5wt0NQcUvGvmqx/14J4BIReW6XgOkVAH7l1l8pEnDUEGIWPg/BPr5MsjaN9/g4NFkVBU6Msf3RiG4yn0cI6DnQwYZuBswnoWEnRQCvEZFruxykK9FIj/UIgD1E5JEuypmvgG9d7ZxrENRb7KKs7RG8r+K+m+nhUEbDveip54N6YnoOmm3eTPJlYG9jAF8XkUOcF9asA4HO9qRPRE4h+T8A3qtrppIBqM3DbU0A34bGlcqQppqd3t26keyUs1kaLY7AZjfzrdZiM7J61aLwR+Puv2htjBTYiFZr8Xw342dtW6ify6YANNR0Iz5WN5gXotnelhEIHEYwyfgqGgHtOQPWitXxR8pLTApYQnP0AZO0fAbAk8p73o7gsHS5hYiZbgdsZx8surfsDWBJi02ZLlbkeNphtr0VETmV5GsRYuFVo7714OoLJP+EkKavhDa2ww7IQW0xb7R9Lg8EZhw2xeWOv4DkJYoNDol4pu8ns5fd1ABg9D7LvrKn8tWfWU5mNAfrb3eotLSudyg/rWXw5ZpioQNF5K/TdW9384naX6P9LyJsd4K2Bi2NGr9ERO4UkVtE5D8Fr5tF5A40bJlMxbShBUaNxeE5VylD3TRqA2UTq0A54kTdC9Ecv20EjYTUlQL1KqkhqCB4YPl4VMvcaWk22L/ZRKoi2OEszzi9+hPcCILB8cHqFVzqUt0x3aUaHiBbZPwzdY7HDMSrgusIhtHHuoNSvIlX9KT9F3fKj6UIBgifZkBigiRwE+Jo4GO8RTynVR3W7fHasndb6KbHpwBQ2UZXR3AKuUk3mloGv4POr7quxYMjCeZ0XisGUm5FcBSIvS5tnVR1PPbVzWtnBNuub7isQ8T0dXyxQMPXW074DAlhvYdzbFRlqe841kmGs3LcWsidk4p48Lu6m2PfaQB269L7v4aGR/egiBwK4MeOZyI6MNvf63uA43Mv6+dbELSKP7WQXW2ilDR5MmvblquQK69NtsZeqRLHWl4ovGkGCDdWsyySLBWNA/iwGwQA2EBBz4CzGWh3DWgHrYjKKvuYQu0GyBiki/bdtKkacyky2I4ZzVVpptEKDQ8zGuqkXTmurPXd5DbJJDALUqJ5CZ+qqq4G8Ak0jNLj0BXeaPubJLeDi7Fk4HmWgUB//S9CZpiK6x+gOU2Tgef1s+ZJFKT5V2hOj5UVOmNHAGv1QCXGcf4+XhB2X4F7NvRS0h4cKqxNW+rnAxkb52TMn5ryxYcUBD7mDpWC7HRxZR37mchrvuP4AjPATAnAO/S7t+vm/nN30OF0izJgc9Fy6cbpH93+RQAvQogD2cu5VFOJ2L8Q7AG9jZ2fO6apeRHJd+m+V+QAUXf73DNtTy+6BqOYmMPu2bcjhGWLc0EzEjDE89yCg2+MoGE8R0Qe1jAv7JIP/DRDGunrUFVp5N4+JuB0EnA4wF7WufhJhPBJAFAuKgG8J+r4zZyB52hg01aXgrJ6xsl+dDMrcopvkZeQ42DUC9BsiPxEJHruZLPcNPru7lkGAI3MseMEhPQ/3hzAb1IGANdCUHXGsbRmG42qr0TkcQTP9EdcP+Slcqu12EjsdPl3hJAreffXEeJOPmecgXGnUqLiM+rUMVYl5eu2tSaNr/WovjXdMJ6DYDx+52RLAN3B1MwJrkWIOVZ2ksG8PpsxphXOGaQPwavzUtcGL/Wx8d+F5AsR1JlnqalPOZIeT6v2eSFDnp2s3vMut2/0hC+6ME9lhIDUN6BZFertwewQ+hmST1UQWCrA54Bg1vWy+N2dAEE3hwdE5EkEe0Ag3/ni/gzMYCDtDQgS8x91k4vezBOU396AEPPU5qXkgOAjvFnDNJyPtoesjqAluNG+LwoA70Sznde2XZyMrazHou8XdTpAOZNLuuwYIKiA5zgGutwvxoIDavds4YAtHQCcLeFPYnBg6ief1D4+ZZoEbA8AH1ZVyGwNEF33AFk38ENzpHZZ6ZHyGKRJyr+F/Hy9xqT2dp593XoXTtV8tTV4I4CHMgCgB7bboGHzOF41sI3PVggqxmv1/VMFjqAOD30icjaCpL0v5xAxGYeqiToQmCrxuxhr+O8zDvUhpKJchGArVlhoMO0YqHrPKo/YBME+8LJejaHrE3MIeQLBs7yOsU6Lvo8XADjZ2fdl8o+oz68HsCvJzQsCx1b7itlMnq9CmDLGZgqpI9hUwgE1IDhQCRoS8wtM/euAXVHgXld+W0NIlZfloCqufrsiaA3qJgWcLvPSSf+ofTMPDXvzWlEAeD8aLuUA8BSSa0fZQorSI9FE38AN5mRLHSSS2lVzQGqRiVPVVFg76Vd9CKqKf3cBlmcK1RHUDA8giJVLGBvripEk8GMkn+OyhHA22QO6U6edJPtF5FwAn0IjnReR7ck75qDgyqNKXM9UKWAFzRJXD2L2V8em6kzrP7NNEZFH9fQdZ5yx9o4gSJ337vHGafE/z9W6THVolZoeJP4PwBloto+aDWRhS36hvLKEZtXfqAQDIZbeFQAunYS8v5MF9I9RidUtvRQUZIQXOk/7OCsdmrcHfB6ADzhbuDEgO5KsPaZz8lC3DqXL+tq8fgBjHZoMa9zr+0rBmmU02gkhBd+ZIrJSpcsdHV7cXmR1OTPnIGr1qSIkf3hFl3hosnjIXASnxDqCWRIAsF0qOPNKegJBHAplvAvRsDfpNNH1A9H/60/xRg00Mp1IVMdOT5jrqvTAyroPwB2R19tskQJ6BlMRkV8jhD7xwCTLbmMOgJNcKjSZbbmCHWCxfK99InIcQkgGS20ENMfnasfIa/r/IIAPRUDSAySzS3l5ZCc7kwC01fn0FtJIm0+HK0jr2AjbO5Xp8+shqFsfV4nUlB/cnNdeCSEI7rVoSNTrU7j+e7JWnLRlFYIdnJdQZUmrvu9iAs7UA2JJw0ZthWAnPISGWo495kXiJGsfUcBWivq4CSwA+CTJHbSOlVgKGNklD+nnm0mug/aZPYrMqxoapmJWR5vrfxKRJyyihK4Lq5s5Qf3U71PmANKh9JS6rz0M4I+uXr7fvDbi9ZZPeTqAQDdm/brGjkAIEfYwGo647T1+0FD7Xu0AYJ+KPbsZ3AcisLVtRudPlvTP3rdx1B/3d1iWbVjPRSNVExDS0AxNQdsmHOQ4NVXdLcRjEAx4yxEItEVqsaf+B8AJxvxnkyOI7x/HgP0G/i808r2iBSPO6m+TBv0ZwBd1rg3nSBDf1c0JeBqdWC0g9Q1oVn36OGY1PfW/QedSpUt1t6lIvoigYvy9iNzfpQH5RIFAUZvSg1QKMuMlYBHoAIIH6ANoVv2JEzQ8AuA3Zt8203iqEzoYv/sSQjzDVTqm6PV8U/BjTkW3ITiEZOW59VEJ5gI4RQ/paHOItExAmwI4xuZqD6o+4Nanz2N88tgmSpXkAgU5NwC4yMUo7bY/vYDojGjc/D1Wr6cDeL5JJKfJlCsBGCa5IYCP6hjfgBBOSVpKAN2ENfqbW4hAiE81ung7YLxL9bJy1jZx/jhVgexgESLaTDaLJvqdRcrMqO+e0WnlHwUW0JTvL2if57gdWXqnxxGCtvoQDrEq2DyGDyN5uLcbaTX+BQ162YO+6GS8i8w1b8M3hOAU8gCavdxYpO4+fAaCSvlsBImq72djSM9FiLFZLcKQCrSNRevZI6lQRaVCH89Yr36s6wgp0TZWs4K+WGKRZcfknGREY4e9HUGN9YSWNxpVIEsF5rMfRHMzM2B8zvsLzyMXaPwWlRqVMNbrvpdSvVbrTbpZD62byLKq/X8d8Q6TfguC88dDaKTJ6zUf7Oredv0QzZGK2nYejhCsmAhOlssnioc5hxBz2rscjfBBiMCNparcBcAnPf/IsQl8Uj+HAbyX5I7K0ytF+icq07RBawDYKAKAZQA/EZF/uHiyXmjzIn3uR06qzC4no/Fki3l7EUI4phLyzS/KKJCKNpJYjmtutgpNZ+tX++BrANbT7+7wmqEiEkBr8OW6cfVr5zxbDT/beuBFE+BRBNWofbcIwHpd6s+zYgEWFfF6yczT3GRaqVIsFDlhq71SVU9Lu7vTyzCAvxYtZzLFwhkxFFttCvHGJjkS2xEnnfp6BHqZc2r6FsndLFVcqwUbqR0mrItagZxOGUoEHuq6gd+KkC5u0DE36bKOb0QIoTGg/VmLgMGXSa5nqeoKrIui2XOabPJ6bcPpgmpXROSXeurvw9isGNbWjQCcRXJ9BYGCYIztpcs+hmgZjSwGNZIf1jkrAD4tItdHG2TmuLpQH+yA73Q8l9y7zDP4XAR7njynkPGCPxYZo4x4dl2Dfjfu30DQoJSjTX4EwYRizPybRAAYZ7WSDseyooeN52s7ba7epKCwNI46iQPTknOoEl0fR6NZAxF/Ggh8P8lD9Jn+KHSaveMJx28GAPyA5FranrKfJwXmivGo3RQXmNd7BSEo8/sy+sjq/Qa997fjBdKRZ3JZTeB+idbmKASwH8lFyDFH0b6od3HoyMqRjFYh6RBs86skP4CgNVip39/jyyoV48csi8gyABfod0Mqut7PiWFZoJyKiKxAI8ZXVZHpxkU7JHpPlo1ZUUmO3bM2QogSK8OfxqTIpqnlPR8hnZydmK4BcMN0sP+LTgWlqL/K7U76EdNjXl5BNOJdHYtg0B1voowW+jyEZO7rWtiLuNwoYLd9XylQX9v82wYXd+X2a90qGRKerNydRfPtWro028D/hhAo2tR4nW7iFptylQKBnyjzNRW7qUc3BPBdJ2GvtOkH5swJv/EZyOzvYO13w4B9MNujAfxJ2ziEZttHa+uzAPyT5IGm9tLLYoLW4+9J7qYbxud0rv4YwNe0v0ayYstljHspJxfqHJMyZsyfjoOhR2YAfSJyvIKIPMeiQhIDJ/WRFgfr0c0wkgCW0PA0L42HP6HhsXoTgN85AGjz+SoAV9qBuxdzLuqDTkDwgqjtTXMio4/LDvw9A8EZY77jjXd5vmhzxPVNuQBwFyddykpUUELDhOQynfPGL+JcweJ4wIkkdxGRIQ3YHEu8hxwwGkYwyfiZC8/U56VeLeLkecnY0fr/kM7NFQAO1dA//oBrfG1DAC9XaeS9WftUJ8KRyJHPNJMXRmAvjuZQVRzzYscXym6tZ+2z5QIHfThAKVn5o/0421rW8Xotgsq/6vi1+XKwSCaQGO3/Iqr4a90mW8670MhDWNH/b3Vi4wqArey+KCF1fJX9fRmLtByVk1WW1aVP27UNglOLGebfBmBQxczSJrh12YmazXvQyvmpbiB9mB7kg2f26ViUENJpLSzAYFaPQZJXEznnB6iq82A9HXopl18AFQdSfk5ykaoO+vS3smMcFf3eTqHrZUhW47mwvrPHKOvzfhFaGyp6WiJCRPy1VKK0gRu/ss6HSgSgO44zhUYQ7RMQQrp0pM5yp726boaDInIwgPfoKa/PMY9hAPur5KSi6pxKBsAbVU/pnB5Gsw3niNuI5yCEfjh/Ig83bj5ZyrwDAJylINAkQn4jqCHYIZ1F8o8kjyS5C8mNSK5Fcm2Sm5PcleQ7SV6kTH0ffeWpCOYLowHpWxwc7SBVcvPI5pBFFHiaC0PRr/aEfg5KJxLUGKzofDwGIaRDn+M7RQ7PVu9+XWML4dLq5Rw4+hDMdcS1o2kNjEcaGGWS+JaTUFmZJ06AfZUfv5JGcZifsQHHh+AXubpU3FVy+93ovqeAdYTkKwGch+As6E0zHo7WovEZm1PrttAkjQZFN9Wna1M5q7907nxeVZt9EX+OA/jPA/Arks+wgM36jIHKWxBS3M3R31apOva3ytMt49cY1afLC2ygZZjkOwC8VOfzXNU67isiFzmbXM+36wCO1HsH0bC/9/1Q6mA+eABccvvcPZFWLI/3HeEwUwXN4b9KCqINFM9vs/caD36O34v83HJ/9+kBd0RxywcQsrRU3H47hIYHdXGtpEOcC0jeSrJOclhzHe7ZxcnrIAZaqZ9f6vIEdwUbdB/JhV2U8WZ9/gn9/EwXZWyiz9f0GiS5hVts00H1W8oRSx9FsqrjWXVtqOn/Q/r3F9tsSjGDAcmDtU9HtKyqK7fqyifJf6lqJGYQcdlzSP7dPTsS1XlYv1tKcue8vsj5/ms6t+skTyG5Zrv+7MYuUCVxdp2v7V+ln6/W+8oFy7NDD0juQPIsrT/1c1D/PofktlE9+rQO5chmbluSD2s/erqF5DFqcI1u2t/l3PWSkeNIPq71qbm5VXOfdL/fT/I2kndqm2JaSvKYWPLS5Vqar+BzROfmcXnrv5v4jFEqzD7He/6jY21raYd4/URSgrjcd2udB6O1WXXf10h+NWdvGHd6Rxtnd13q5vGDJNfsVYaFvDJIvk7bOpTDr4b1epLkfh287xkkf+h41aAra1gDXGfuFSTnkrzIzam4TiN6LSG5UxYvjiWBjj9vRvIu7eO8Ng/qOCwheUQWf1Z+cZZbU1XH01+SUR+7ytFv73L8iiR/o3ES4VLFlqJnXqJreFjbcNQ498hyzu8f0n4ZivrKj8Ow1v8VGTw6a929082HmIf5/e12krsUaMM87Y8/uDEddHv4kyTX9WugE0PkfkXoxyEEJR1SRHq/irBbJZH2UsQ6grHm9mh4Hi0BcHObMrJOpU/Xk6tofa7Tz1KBehhtDGATNAyN70QIalykb0y6tQ6Ci/WQSih+JSIHWHiKqfZWi0T2u6vae3MAByLYWxSlfwD4g54iHkPITVvPUM1D1VQjbr4UpbP1ukXVPvMA7KWnpWcjGE5vXLCsIVXxXaCn7OvQiIG0JYI38nz9fBmAHaLnH1VV/t9VMrwSDdvOlV6U3uF4lNwJeyPtxy30/4NE5Cw1u6gVHNuSShpG9Ls9EOIyvjQ6YT6pkq5TANyi5hijzEPb/1KVJtpzywD8Xp+5SkSWuM2qljX2EzB37URfU3uip6nq+wA0Qjh5aWXd8ZaBnKJXqETxCyJykzH+dn3u+tviji1WqfGuAPbF2LBWdyIE+f0ngunLCIKJyYX6vvo41rLZH+8C4BInwdhJRK5TCXE9mndUdfmmWvcXAXhJB1W4WHnA7QheuRc6vlofp+E9VJIxTPIwnXNEiBjwzl7xU2eXtpPygQ0QHPj2RWcOezeqSu1BjM1gYnvLDro3tFL1LRaRe3QOrobgYLlAx+mADvjdIIDfIJhLPIoQceCOSAsD1R5UdO48D8C5bSTAnq5EMJW4RfnikOU4JrmX8o7n6x5v9DuEED//VEcfPxbr6p70KTRCqF2O4LjwMx2nfte/AzpnN0aIAfrKjDqaGcHVKpF8RNdHLq9y69q8oPfUd22sY7BHh9PshwgBre/X/cLMxBYpr39lh3svVPNiAfK9hmZA1/OObebKjcqzRlTiWu8EANqE2QIhFtVcrUS3Kk7vATkesX69S1VclqpzPHXx8Y+eJyKXFN3EJwkAWuypsxASqpv37ZNoNmpuxVxXcyqAK1TNO5IDAP07PwngFU6l598lkSrP8jL/VESOVfuOv6Bh8D6s4CsrHySjsitaXl1V158QkR9r/V6vapCq3j+soMA20ZqqNeZE5d2jDOExNOef7mZcyto/z1TV0JoKAM/sdO741G/2HMnNlVm+DME+dQsHiB5E8Mavab8vUOZhoQJuQ/DI/KuI3B5Jd0eN8CfrcOOBoNtwtlLA+nKEcFKL2xTzqG5c5wP4udqbQaVphezKTAWqIOWLCAbW5rQwpBtOyfGm+U6NZHP8ehHZr1v+EDlgWF2OAPA9vWUnEbnGlx+tx68geCyaE8IKNKe6auUMNB8NM5LLEByaRkOIWL26OBTF756nG9Ymumld698xzrlk6+5YVR+aanMlxgZXb/Wu+Rmqzdjhrao8Nt5bLLvJfcpPhhWYLVZANqD3DEX8Di3eZwDSeNeHReQMnd81v2bNlloP6S9GSL820EaIQy1/rh4AXqUHxD4dF1uXT1EQ+yI9XP+PlrFcAZE/oG2sh7jblc//FMCFijXMk9XMXerqZHGBPlN1+5dE+5TZVw8A+LWIvMtsoXP2KjgAuBZC3vVN0LCvfTxaH2yxZ5Z0/vYDuEJETKtzpoJ6v+7qGfNNkB09Y56bb1nvH9EyY3tdw2m/EZGP+4OUdMN8SX4PIebOMMYaRcbGkXlUiiR+NkFtMEttwJrpxCUCYSwA5OI0Q34R19Cs529Vh1I0YH0ISaj3jU/f0wQEItqcYoeQrFAQjPrGSx5GF2ird7qMCnFqn6x+NW8170kVeyOXcgAfMv6vR9Jav1FV0BxvrJwxl5u8tpQJNRkJj2dDcger3RFy0J4iIg91M38iR5+m/KOqtt1QT6Ab67Wak4Y9pKDvfgD3mzTRgb4mD+mpkGpHc1hsw9HfFqk0dSMEG9E10LB7eUyB+90icpeXUisjrHdRB8/j/CG0lDH/4uCxTYGOxyk1KylfHlZznN0AnCQij2ZIAMXx8Eq0tlpFVGAGfyy5NVrqxaHAe2xr2TuqtuJC18/olQOIZZ1Bs1d5Vow85PDFmFdIjpapnMObyiIyGEmVkTEueZ6vWXVq4neujaPS5mgO96vDgNl313LK9nusL6sctVsi3jFX+c4GegBd3wHNx1UjcyuAuyxmrpubtdjTPINvl3OEQnXPJ9p57OccoMtubZcxNmSXtNgzmSHoikFeqU1fx++o5exzWXtjLGDxdtOje2CnANA8zrZVCdBADpDoRHpXc0yzG+lbPQKVnT7rTw+dxuurRgC4gmAgfMF0kf5lqI3QC2DqFn5LlYwzGq8VUbFlgcceAod48+4KvHlvOy2jPt6+7NVcidrqmdpIh2X0ufUxLXOu6jjYqb7Wwbw1KaZ5AxeWWHlbnm7H3af364U0y4Gmaqv1EwGNcQN53w6/Qfdg7sIfLP1BsMfgb8p5tBu/ei/6sAUvyIpnOS4+Ftm1eSBScu+sdlBenxfQ6CEg0zu9SF3dOFfatS8DhPdqrpUypHpTeYBumgvSxcNlFRsfj6DvH9aTwxIEvfbK+EQYvcdsn7ZC8FIxYHkrgEPQrNvOi+1np8HTEbx4gaDnf4Oe9ltFyaerw7dU6mJt+BCC/UQl4yTEeHIj2FNtj4bt33kI6jbBNNo0W8RO6pbieET1gpIKQbE8plknpl7VV6JDC9BdnEbpBaOIpHbSqUSqyKacsf7y2iKRxArTSYpdsA+LHPpKbpOpd/EeZDH1yZw3OZt82UsKWqi6ZJy8QHIkFOwhALQDucUM7Tk/jYLyTkac0bjPYgBFjNWo9eI9maAjh1d0UnaWqlIy9n0pMOfq7dZHpAEo0kdS9LCfsbZ70fd+H6tjrAZgMqmp/7teSy60yiKS90TeZ1/pZLGTvM55DT2pNj2d1OUq5zH0QCdewOpN+pDz+lyuaqSiz7/JtX1EPZp31t8qE+0dORMojo/WafaDXvZhHM+v12VOx/I6fd9sm7N5Y54V43Gq5tBEj2m7NTne90xQEPBJm49TPY4TOacmeq7mZdgZzxgWDYk0UWPcC2/26cTjJ2QuuLAMPsyHhYx4lQNYfVGoCbsGtCO+GoWDOU7B5ZwWcQUrrrxrHQB8kOTGFiKhxfMD+nlwFH7jt/rugZznKyTnaNueqXX2YTY+p7/1TdUgz7RNOVGiRDNjs080ueOYaHb0xaw9YLtYQj93QKpG8lEXh8qAVJzdwQDk7hmx4AZagYSonGscAHyI5Ab6fakFg7TYRWfrcwbgjtDv+6Mo7KPt1Xev6YCngcerI9CaFnGiRIkSJUqUaFaic1MFb+gCrBqQu4bk6i7YbF56r7kKnuiCjb7YguX2EgBG4G9LDdxcd0Eu13ftGhOxXK9+kue6+o5oUNpdHEgspdmRKFGiRIkSJZrO1BVYcbkbyyJyP4LzxTCC0e4wQoDmMxFiEVn6Kf8sEMIIrALw86g+R7rk4D0DU97NG8DhCDGcViIYR/5ORB7UkBw1B/oMiJrh5g8RgqYOazkVAMeIyJU+MG6iRIkSJUqUKNGsJCcVs5RERzop4JBL5TJXf69E6WjsuU1VAmfpT1Zo6hzJcqYYhwrYO6/c79LZVS0FmZNWjqbMcf+fmtG+E9xzpaT6TZQoUaJEiRLNdgCYlZfyy049aiDpD+ad6+z74ue+q/eu0M8zHGgsxYaUOQDwwSwAGEnyQPJjkePJ3yLQV3JOH6K2fT/JaNdPXf7KpPZNlChRokSJEv3XgUCfYPoHDiyZg8VlJLfR371jiIGsp6lDRdUlR362u79UAAB6CWA5ut+A5EYkH9F3DOtzB7r32L39+t1aJM9zkr9VTrLZ3yp5dKJEiRIlSpQo0WwHgeI9YEmekgGaHiK5r3uuP1IF/zDyyr3AhZHpGADmqJu/G0n/LnWqYXNYMQ/lZ7ryPZj9Ncl5MdBMlChRokSJEiX6bwSCZjNnAOp4F+TZQGCd5FdIrqb39DnJ2+Ykl0ZhYd5p9xUEgBu6usRq5pe4eIUjKgXc04HRinv2Xa7Oq5y08AwnHUxq30SJEiVKlCjRfz0AbJIE6ndHO/A0pKCLJC8n+WL3rAVY/qiTuFXVOeSZ+lslI5xMbANoANCkegbW1iF5RxS77zT/bv17N5LnO7C6ytX56w4gJslfokSJEiVKlChRhiOFSd5eqmnaDASaKrWmzhXPcGWspuDQq2nvILmJgUB7VwYAjFXAJlmcS/KPEQhdSnKxe++mKrGs6n3Drp5LSR7myk3gL1GiRIkSJUqUKAKB4sCggcDNSP7KgbVBlzpuiORJLpjyVhpc2ecYvoHkxvq7z9RxTZQL2ADggH2SPCsCf3Wn+n0qyS9q9pJYXW3OK8904C+FeUmUKFGiRIkSJcoCgREg9PZ7b1VVLV0e3boDhb8nuR/Jd2tIGG8PeCvJp7tyKxkSwE3cu9bXEDQG/ob1Xd/UbCOnK9CkkziaBPAJzUtsEse+BP4SJUqUKFGiRIkKAEHnXVt2UrtN1RvXq4JXOPBFkv/R9HJ1lRQOO3Xse53N4OWujPucc8nrtAwDfyNa1pMkb2czrYze/VtTS/tUdmlEEyVKlChRokSJigFAn/u3Kb8vyV3VBnDYga9VTuJHFxew5lTGJHkdyU+RvNupdR8l+RmSf49UzbXoopa1ykkfLWD1Xq5+/cneL1GiRIkSJUqUqDfAsBQFat6J5AnOUYQO8FmqtqqCtWoEGOmAXT0CjiNOgmjPDUf3LdfQLnu6+vh4hknylyhRokSJEiWadTQlAEeBVRkARKSq360D4JUAdgNwAICF8WMAagDq+ncdQEXbQP2s6r2l6PK0CsClAM4HcKaI3G7AT8uojXaOCNMUSZQoUaJEiRIlANhbEDh6GRDU3zYG8AIAzwewM4BtAMzv8lUrANwB4EoFfn8WkX+7d5la2oBlAn6JEiVKlChRogQAJwEIAioRVDA4EgG0dQFsBWBLAJsAWB9BQjgfQL+2YwhBurcUwCMA7gFwO4CbATwsIoOuzJK+r65Xo0MS+EuUKFGiRIkSJQA4eUBQROgkgyUFZNUelV/WMmsAmIBeokSJEiVKlCgBwGkEBBX40f0/CgjRsPmrG5BzUsT4XrvP/obdnwBgokSJEiVKlOi/lf4/Uz0PtUXm8IEAAAAASUVORK5CYII=";

// Per-company color — identical hash+palette to the Quotes app so a company's
// hue is the SAME in both systems.
const CLIENT_PALETTE = ['#f87171','#fb923c','#fbbf24','#a3e635','#4ade80','#2dd4bf','#58a6ff','#818cf8','#a78bfa','#f472b6','#fb7185','#22d3ee'];
function companyColor(name){
  const n=(name||'Unassigned').trim(); let hash=0;
  for(let i=0;i<n.length;i++) hash=(hash*31+n.charCodeAt(i))>>>0;
  return CLIENT_PALETTE[hash % CLIENT_PALETTE.length];
}
function initials(name){ return (name||'?').replace(/[^A-Za-z0-9 ]/g,'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')||'?'; }

// ── Utils ────────────────────────────────────────────────────────────────────
// TOTALS. Always two decimals, because a total is an amount of money somebody
// pays. Line amounts, subtotals, invoice values and every KPI use this.
const money = (n, c='USD') => n == null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(n);

// ── UNIT prices, which are not the same thing ────────────────────────────────
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ A UNIT PRICE IS A RATE, NOT AN AMOUNT.                                    │
// │                                                                           │
// │ vessl.sales_order_items.client_price and the purchase-order price columns  │
// │ hold numeric(18,5) since 13 -- a bag can genuinely cost $0.17780 each, and │
// │ 24 live rows already carry 3-4 decimals. Rendering those through money()   │
// │ shows $0.18 and quietly claims a precision the business does not have.     │
// │                                                                           │
// │ MINIMUM 2, MAXIMUM 5, trailing zeros trimmed. $1.50 stays "$1.50" rather   │
// │ than becoming "$1.5" or "$1.50000"; $0.17780 shows as "$0.1778". So a      │
// │ price with nothing past cents is indistinguishable from what money()       │
// │ printed before, and nothing on screen changes until somebody enters a      │
// │ finer price -- which is the entire point.                                  │
// │                                                                           │
// │ Do NOT use this for a total. quantity x unit_price is money owed and       │
// │ rounds to cents; showing $1,234.56780 on an invoice line would be wrong.   │
// └───────────────────────────────────────────────────────────────────────────┘
const unitPrice = (n, c='USD') => {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  const v = Number(n);
  // Count the decimals the value actually has, capped at 5. toFixed(5) then
  // stripping zeros is what trims: 1.5 -> "1.50000" -> "1.5" -> 1 decimal, so
  // the max() floors it back to 2 and $1.50 renders as $1.50.
  const trimmed = v.toFixed(5).replace(/0+$/, '');
  const decimals = Math.max(2, Math.min(5, (trimmed.split('.')[1] || '').length));
  return new Intl.NumberFormat('en-US', {
    style:'currency', currency:c,
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(v);
};
const moneyCompact = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1000000) return '$' + (n/1000000).toFixed(a>=10000000?1:2).replace(/\.0+$/,'') + 'M';
  if (a >= 1000) return '$' + (n/1000).toFixed(0) + 'K';
  return '$' + Math.round(n);
};
const fmtDate = s => { if (!s) return '—'; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s+'T12:00:00' : s); return isNaN(d) ? '—' : d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
const fmtDateShort = s => { if (!s) return '—'; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s+'T12:00:00' : s); return isNaN(d) ? '—' : d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
const etaDays = eta => { if (!eta) return null; const d = Math.round((new Date(eta) - new Date()) / 86400000); return isNaN(d) ? null : d; };
const fmtDateTime = s => { if (!s) return ''; const d=new Date(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
const timeAgo = s => { if(!s) return ''; const m=Math.round((Date.now()-new Date(s))/60000); if(m<2) return 'now'; if(m<60) return m+'m'; const h=Math.round(m/60); if(h<24) return h+'h'; const d=Math.round(h/24); if(d<7) return d+'d'; return fmtDate(s); };

// ── Sales Orders constants ────────────────────────────────────────────────────
const SO_STATUSES = ['received','confirmed','testing','in_production','shipped','delivered','invoiced','closed'];
const SO_SM = {
  received:     {label:'Received',     color:'#6366f1',bg:'#eef2ff'},
  confirmed:    {label:'Confirmed',    color:'#3461e0',bg:'#eff6ff'},
  in_production:{label:'In Production',color:'#d97706',bg:'#fffbeb'},
  testing:      {label:'Testing',      color:'#db2777',bg:'#fdf2f8'},
  shipped:      {label:'Shipped',      color:'#0891b2',bg:'#ecfeff'},
  delivered:    {label:'Delivered',    color:'#059669',bg:'#ecfdf5'},
  invoiced:     {label:'Invoiced',     color:'#7c3aed',bg:'#f5f3ff'},
  closed:       {label:'Closed',       color:'#64748b',bg:'#f8fafc'},
};
// Map shipment/PO-specific statuses onto the aligned SO status set so every tag matches
const STATUS_ALIAS = {
  created:'confirmed', at_origin_port:'shipped', in_transit:'shipped',
  at_transshipment:'shipped', at_destination_port:'shipped', customs:'shipped',
  out_for_delivery:'shipped', cancelled:'closed', ready_to_ship:'in_production',
};
const alignStatus = s => STATUS_ALIAS[s] || s;
const genSONum = (list=[]) => {
  const yr = new Date().getFullYear();
  const pfx = 'KUI-SO-'+yr+'-';
  const nums = list.map(n=>{ const m=(n||'').match(/KUI-SO-\d{4}-(\d+)/i); return m?parseInt(m[1]):0; }).filter(n=>n>0);
  return pfx+String(nums.length?Math.max(...nums)+1:1).padStart(3,'0');
};
const mgnColor = p => p===null?'#94a3b8':p>=25?'#059669':p>=15?'#d97706':'#dc2626';
const soMetrics = so => {
  const rev = (so.sales_order_items||[]).reduce((a,i)=>a+(Number(i.quantity)||0)*(Number(i.client_price)||0),0);
  const factoryCost = (so.sales_order_pos||[]).reduce((a,l)=>a+((l.purchase_orders?.purchase_order_items)||[]).reduce((b,i)=>b+(Number(i.quantity)||0)*(Number(i.unit_price)||0),0),0);
  const addlCost = (so.order_costs||[]).reduce((a,c)=>a+(Number(c.amount)||0),0);
  const cost = factoryCost + addlCost;
  return {rev, cost, factoryCost, addlCost, gross:rev-cost, mgn:rev>0?(rev-cost)/rev*100:null};
};

// Auto-create shipment when a PO moves to shipped — callable from any component
async function createShipmentForPO(poId) {
  try {
    const { data: links } = await SB.from('shipment_pos').select('shipment_id').eq('purchase_order_id',poId).limit(1);
    if (links && links.length > 0) return false;
    const { data: po } = await SB.from('purchase_orders').select('id,order_number,client_po_number,client_company_id').eq('id',poId).single();
    const ref = po?.client_po_number || po?.order_number || poId.slice(0,8).toUpperCase();
    const num = ref;
    const { data: ship, error: sErr } = await SB.from('shipments').insert({
      shipment_number: num,
      status: 'in_transit',
      client_company_id: po?.client_company_id||null,
    }).select('id').single();
    if (sErr||!ship) return { error: sErr?.message||'Could not create shipment' };
    const { error: lErr } = await SB.from('shipment_pos').insert({ shipment_id:ship.id, purchase_order_id:poId });
    if (lErr) return { error: 'Shipment created but link failed: '+lErr.message };
    return { ok: true, shipmentNumber: num };
  } catch(e){ return { error: e.message }; }
}
const fmtNum = n => n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
const nowDate = () => new Date().toISOString().slice(0,10);
const STATUSES = ['draft','confirmed','sampling','sample_approved','in_production','ready_to_ship','shipped','delivered','closed','cancelled'];
const TEAM = [
  { name:'Kristy',  email:'kristy@kinguniversal.com' },
  { name:'Loren',   email:'loren@kinguniversal.com' },
  { name:'Riley',   email:'riley@kinguniversal.com' },
  { name:'Steven',  email:'steven@kinguniversal.com' },
  { name:'Carmela', email:'carmela@kinguniversal.com' },
];

function Badge({ status }) {
  const a = alignStatus(status);
  const m = SO_SM[a] || {label:(status||'—').replace(/_/g,' '),color:'#64748b',bg:'#f8fafc'};
  return <span style={{display:'inline-flex',alignItems:'center',gap:'5px',padding:'3px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:700,letterSpacing:'.03em',textTransform:'uppercase',background:m.bg,color:m.color,whiteSpace:'nowrap'}}>
    <span style={{width:'6px',height:'6px',borderRadius:'50%',background:m.color}} />{m.label}
  </span>;
}

// ── PO browsing helpers (search + client filter, shared by Orders & Dashboard) ──
const poClient   = p => p.client?.name || '';
const poFactory  = p => p.factory?.name || p.companies?.name || '';
const poProducts = p => (p.purchase_order_items||[]).map(it=>it.products?.name||it.description||'').join(' ');
function filterPOs(rows, { search, client, status }){
  const s = (search||'').toLowerCase().trim();
  return (rows||[]).filter(p=>{
    if (status && status!=='all' && alignStatus(p.status)!==status) return false;
    if (client && client!=='all' && poClient(p)!==client) return false;
    if (s){
      const hay = ((p.client_po_number||'')+' '+(p.order_number||'')+' '+poClient(p)+' '+poFactory(p)+' '+poProducts(p)).toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}
function distinctClients(rows){
  const m={}; (rows||[]).forEach(p=>{ const c=poClient(p); if(c) m[c]=(m[c]||0)+1; });
  return Object.entries(m).sort((a,b)=>a[0].localeCompare(b[0]));
}
const PO_CARD_SELECT = 'id,order_number,client_po_number,status,production_pct,order_date,requested_ship_date,factory:companies!factory_company_id(name),client:companies!client_company_id(name),purchase_order_items(description,products(name))';

function OrderCard({ p, navigate, onStatus }){
  const client = poClient(p), factory = poFactory(p);
  const items = (p.purchase_order_items||[]);
  const itemCount = items.length;
  const go = ()=>navigate('order-detail',{id:p.id});
  return (
    <div className="po-card" onClick={go}>
      <div className="po-card-stripe" />
      <div className="po-card-body">
        <div className="po-card-top">
          <div style={{minWidth:0}}>
            <div className="po-card-kicker">Purchase Order</div>
            <div className="po-card-num">{p.client_po_number||p.order_number||'—'}</div>
          </div>
          <Badge status={p.status} />
        </div>
        <div className="po-card-parties">
          <span className="po-card-av" style={{background:companyColor(client||factory)}}>{initials(client||factory)}</span>
          <div style={{minWidth:0,flex:1}}>
            <div className="po-card-client">{client||'No client'}</div>
            {factory && <div className="po-card-factory"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20h20M4 20V8l5 3V8l5 3V8l5 3v9"/></svg>{factory}</div>}
          </div>
        </div>
      </div>
      <div className="po-card-foot">
        <span className="po-card-meta">{fmtDate(p.order_date)}{itemCount>0?' · '+itemCount+' item'+(itemCount!==1?'s':''):''}</span>
        {onStatus
          ? <select className="po-card-select" value={p.status} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();onStatus(p.id,e.target.value);}}>{SO_STATUSES.map(s=><option key={s} value={s}>{(SO_SM[s]?.label)||s.replace(/_/g,' ')}</option>)}</select>
          : <span className="po-card-meta">Ship {fmtDate(p.requested_ship_date)}</span>}
      </div>
    </div>
  );
}

// ── PO toolbar (search + client chips + status chips), shared UI ────────────────
function PoToolbar({ rows, search, setSearch, client, setClient, status, setStatus }){
  const clients = distinctClients(rows);
  const clientOptions = [
    { value:'all', label:'All Clients' },
    ...clients.map(([c,n])=>({ value:c, label:c, color:companyColor(c), count:n })),
  ];
  const statusOptions = [
    { value:'all', label:'All Statuses' },
    ...SO_STATUSES.map(s=>{ const m=SO_SM[s]; return { value:s, label:(m&&m.label)||s.replace(/_/g,' '), color:m&&m.color, bg:m&&m.bg }; }),
  ];
  return (
    <div className="po-toolbar">
      <input className="po-search" placeholder="Search PO #, client, or product…" value={search} onChange={e=>setSearch(e.target.value)} />
      <div className="fs-row">
        <FilterSelect label="All Clients"  value={client} onChange={setClient} options={clientOptions} />
        <FilterSelect label="All Statuses" value={status} onChange={setStatus} options={statusOptions} />
      </div>
    </div>
  );
}


// ── Icons (inline SVG, 1.6px stroke) ─────────────────────────────────────────
const Ic = {
  'sales-orders':<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="12" y1="17" x2="8" y2="17"/><line x1="20" y1="17" x2="17" y2="17"/><polyline points="17 15 19 17 17 19"/></svg>,
  dashboard:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  orders:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  companies:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/></svg>,
  products:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>,
  testing:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>,
  pricing:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  programs:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>,
  shipments:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6h13v9H1zM14 9h4l3 3v3h-7z"/><circle cx="5.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>,
  inventory:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  quotes:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9.5 14.5h3.5a1.5 1.5 0 0 0 0-3h-2a1.5 1.5 0 0 1 0-3H14"/></svg>,
  codes:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>,
  'client-relations':<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v4l-4-4H9a1.9 1.9 0 0 1-1.4-.6"/><path d="M3 4h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>,
  settings:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

// ── Staff domain gate ────────────────────────────────────────────────────────
// orders.vessl.io is staff-only, but kui.vessl.io (the client portal) shares
// this Supabase project and therefore its auth.users pool — so a portal account
// is a valid credential here unless we check the domain ourselves.
// Mirrors portal.is_kui_staff() in Postgres, which is
//   auth.jwt()->>'email' ilike '%@kinguniversal.com'
// so the UI and RLS agree on who counts as staff. Non-string input (null,
// undefined, a missing email claim) short-circuits to false rather than throwing.
const isStaffEmail = email =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');

// ── Role-based page access ───────────────────────────────────────────────────
// Only roles listed here are limited, to exactly the page ids they map to.
// Any other role — including no staff_profiles row, or a lookup error — is
// unrestricted and sees every page, exactly as before.
const ROLE_PAGES = { limited_qc: ['testing', 'products', 'shipments', 'codes'] };
// Returns the allowed page ids for a limited role, or null meaning unrestricted.
// hasOwnProperty guard: role is free text, so a value like 'constructor' must
// not pick up an inherited Object.prototype member and read as limited.
const allowedPagesFor = role =>
  (role && Object.prototype.hasOwnProperty.call(ROLE_PAGES, role)) ? ROLE_PAGES[role] : null;

// ── Tab in the URL hash ───────────────────────────────────────────────────────
// A refresh used to land back on Programs whatever you were looking at.
//
// The HASH and not a query param, deliberately: reading a query param in the App
// Router means useSearchParams, which has to sit inside a Suspense boundary and
// fails the build without one. The hash needs no routing at all -- it never
// reaches the server, so a statically prerendered route can carry it.
//
// so-detail and order-detail are NOT here even though they are real pages. Both
// render from params.id, which the hash does not carry, so restoring one would
// mount a detail view with an undefined id. settings IS here: it takes no params
// and is reached from the gear.
const HASH_PAGES = [
  'programs', 'dashboard', 'sales-orders', 'orders', 'companies', 'products',
  'testing', 'pricing', 'shipments', 'inventory', 'quotes', 'codes',
  'client-relations', 'settings',
];

// "Landing on the list is the honest fallback" is what the note above used to
// promise, and it was never true: a detail page resolved to null and the caller
// fell through to its own default, which is Programs. So a refresh on a purchase
// order dropped you two levels, not one. These are the same pairings the sidebar
// already uses to decide which nav link looks active.
const DETAIL_PARENT = { 'so-detail': 'sales-orders', 'order-detail': 'orders' };

// The one place a stored page id is turned into something renderable. Everything
// -- hash, localStorage, old URLs still in someone's history -- goes through it,
// so a value that is empty, garbage, or from a build that named pages
// differently degrades the same way: null, and the caller keeps its default.
//
// hasOwnProperty rather than a bare lookup: these ids come from a URL and from
// disk, so a value like 'constructor' must not pick up an inherited
// Object.prototype member and resolve to a page. Same guard as allowedPagesFor.
const normalizePage = raw => {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (HASH_PAGES.includes(v)) return v;
  if (Object.prototype.hasOwnProperty.call(DETAIL_PARENT, v)) return DETAIL_PARENT[v];
  return null;
};

// Null during prerender, where there is no window.
//
// decodeURIComponent throws a URIError on a malformed escape -- a bare '%' in
// the fragment is enough. Unguarded that would kill the restore effect on mount
// and take the whole page down with it, so a bad fragment is treated as no
// fragment.
const pageFromHash = () => {
  if (typeof window === 'undefined') return null;
  let h;
  try { h = decodeURIComponent(window.location.hash.replace(/^#/, '')); }
  catch (e) { return null; }
  return normalizePage(h);
};

// ── The localStorage fallback ────────────────────────────────────────────────
// The hash alone was not enough on mobile. It survives a Safari refresh, but not
// the ways a phone actually re-opens this app:
//
//   - A home-screen icon is a plain bookmark pinned to the URL captured when it
//     was added. There is no manifest and no apple-mobile-web-app-capable, so
//     iOS re-launches that exact URL every time -- hashless, if it was saved
//     from the login screen or from before the hash existed.
//   - iOS evicts these from memory aggressively, so returning to the app is a
//     fresh load from that same stored URL rather than a resume.
//
// localStorage and NOT sessionStorage for exactly that reason: a re-launch is a
// new session, so sessionStorage would be empty precisely when it is needed.
const TAB_KEY = 'vessl.tab';

// Reads and writes are both wrapped: localStorage throws, not returns null, when
// storage is unavailable -- iOS private browsing, or a blocked-cookies setting.
// A phone that cannot store a tab should still render the app.
const pageFromStore = () => {
  if (typeof window === 'undefined') return null;
  try { return normalizePage(window.localStorage.getItem(TAB_KEY)); }
  catch (e) { return null; }
};

const storeTab = p => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(TAB_KEY, p); } catch (e) {}
};

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ page, navigate, user, open, badges={}, allowedPages=null }) {
  const links = [
    { id:'programs',           label:'Programs' },
    { id:'dashboard',          label:'Insights' },
    { id:'sales-orders',       label:'Sales Orders' },
    { id:'orders',             label:'Purchase Orders' },
    { id:'companies',          label:'Companies' },
    { id:'products',           label:'Products' },
    { id:'testing',            label:'Testing' },
    { id:'pricing',            label:'Pricing' },
    { id:'shipments',          label:'Shipments' },
    { id:'inventory',          label:'Inventory' },
    { id:'quotes',             label:'Quotes' },
    { id:'codes',              label:'Codes' },
    { id:'client-relations',   label:'Client Relations' },
  ];
  const activeFor = { 'sales-orders':['sales-orders','so-detail'], 'orders':['orders','order-detail'] };
  const shownLinks = allowedPages ? links.filter(l => allowedPages.includes(l.id)) : links;
  return (
    <aside className={'sidebar ' + (open?'sidebar--open':'')}>
      <div className="sb-brand">
        <img className="sb-logo-img" src={LOGO_WHITE} alt="King Universal" />
      </div>
      <div className="sb-scroll">
        <div className="sb-section">Workspace</div>
        {shownLinks.map(l => (
          <button key={l.id} className={'nav-link '+((activeFor[l.id]||[l.id]).includes(page)?'active':'')} onClick={()=>navigate(l.id)}>
            <span className="ic">{Ic[l.id]}</span>
            <span style={{flex:1}}>{l.label}</span>
            {badges[l.id]>0 && <span className="sb-badge">{badges[l.id]>99?'99+':badges[l.id]}</span>}
          </button>
        ))}
      </div>
      <div className="sb-bottom">
        {!allowedPages && (
        <button className={'nav-link sb-settings ' + (page==='settings'?'active':'')} onClick={()=>navigate('settings')}>
          <span className="ic">{Ic.settings}</span> KUI Settings
        </button>
        )}
      </div>
    </aside>
  );
}

// ── Toast system ─────────────────────────────────────────────────────────────
const ToastCtx = React.createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type='ok', action=null) => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type, action }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);
  // global bridge for non-hook callers
  useEffect(() => { window._toast = push; return () => { delete window._toast; }; }, [push]);
  const dismiss = id => setToasts(p => p.filter(t => t.id !== id));
  const icons = {
    ok: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
    err: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    info: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={'toast ' + t.type}>
            <div className="toast-icon">{icons[t.type]||icons.info}</div>
            <div className="toast-body">
              <div className="toast-title">{t.msg}</div>
              {t.action && <div className="toast-action"><button onClick={t.action.fn}>{t.action.label}</button></div>}
            </div>
            <button className="toast-close" onClick={()=>dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => React.useContext(ToastCtx);

// ── Task Panel ────────────────────────────────────────────────────────────────
function TaskPanel({ open, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    SB.from('tasks').select('*').order('created_at').then(({ data }) => { setTasks(data||[]); setLoading(false); });
  }, [open]);
  const addTask = async () => {
    if (!input.trim()) return;
    const { data } = await SB.from('tasks').insert({ title: input.trim(), done: false }).select().single();
    if (data) { setTasks(p => [...p, data]); setInput(''); }
  };
  const toggleTask = async (t) => {
    const done = !t.done;
    setTasks(p => p.map(x => x.id===t.id?{...x,done}:x));
    await SB.from('tasks').update({ done }).eq('id', t.id);
    if (done) toast('Task completed', 'ok');
  };
  const open_ = tasks.filter(t=>!t.done).length;
  return (
    <div className={'task-panel ' + (open?'open':'')}>
      <div className="task-panel-head">
        <h3>Tasks {open_>0?'('+open_+' open)':''}</h3>
        <button className="task-panel-close" onClick={onClose}>×</button>
      </div>
      <div className="task-list">
        {loading ? <div className="task-empty">Loading…</div> :
         tasks.length===0 ? <div className="task-empty">No tasks yet. Add one below.</div> :
         tasks.map(t => (
          <div key={t.id} className="task-item" onClick={()=>toggleTask(t)}>
            <input type="checkbox" className="task-cb" checked={t.done} readOnly />
            <div className="task-body">
              <div className={'task-title'+(t.done?' done':'')}>  {t.title}</div>
              {t.assignee && <div className="task-meta">{t.assignee}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="task-add">
        <input placeholder="Add a task…" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTask()} />
        <button className="btn btn-dark btn-sm" onClick={addTask}>Add</button>
      </div>
    </div>
  );
}

// ── Top Bar ──────────────────────────────────────────────────────────────────
function TopBar({ user, title, taskCount=0, taskOpen=false, onBell, onSettings }) {
  const [drop, setDrop] = useState(false);
  const initials = (user?.email||'KU').split('@')[0].slice(0,2).toUpperCase();
  const name = (user?.email||'').split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      <button className={'tb-bell'+(taskOpen?' active':'')} title="Tasks" onClick={onBell}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        {taskCount>0 && <span className="tb-bell-badge">{taskCount>9?'9+':taskCount}</span>}
      </button>
      <div className={'tb-profile ' + (drop?'open':'')} onClick={()=>setDrop(p=>!p)}>
        <div className="tb-avatar">{initials}</div>
        <div className="tb-uname">{name}</div>
        <svg className="tb-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        {drop && (
          <div className="tb-dropdown" onClick={e=>e.stopPropagation()}>
            <div className="tb-drop-head">
              <div className="tb-drop-name">{name}</div>
              <div className="tb-drop-email">{user?.email}</div>
            </div>
            <button className="tb-drop-item" onClick={()=>{setDrop(false);onSettings&&onSettings();}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
            <div className="tb-drop-divider" />
            <button className="tb-drop-item danger" onClick={()=>SB.auth.signOut()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Login ────────────────────────────────────────────────────────────────────
function Login() {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [err,   setErr]   = useState('');
  const [mode,  setMode]  = useState('signin');
  const [note,  setNote]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const submit = async () => {
    setErr('');
    const { error } = await SB.auth.signInWithPassword({ email, password: pass });
    if (error) setErr(error.message);
  };
  const sendReset = async () => {
    setErr(''); setNote(''); setBusy(true);
    const { error } = await SB.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setBusy(false);
    if (error) setErr(error.message);
    else setNote('If that email has an account, a reset link is on its way. Check your inbox.');
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">
          <img className="login-logo-img" src="/logo.png" alt="King Universal" />
        </div>
        <div className="login-sub">{mode==='signin' ? 'Operations Platform · Sign in' : 'Operations Platform · Reset password'}</div>
        <input className="login-field" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(mode==='signin'?submit():sendReset())} />
        {mode==='signin' ? (
          <>
            <input className="login-field" type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} />
            <button className="btn-login" onClick={submit}>Sign In</button>
            <button className="login-alt" onClick={()=>{setMode('forgot');setErr('');setNote('');}}>Forgot password?</button>
          </>
        ) : (
          <>
            <button className="btn-login" onClick={sendReset} disabled={busy||!email.trim()}>{busy?'Sending…':'Send reset link'}</button>
            <button className="login-alt" onClick={()=>{setMode('signin');setErr('');setNote('');}}>← Back to sign in</button>
          </>
        )}
        <div className="login-note">{note}</div>
        <div className="login-error">{err}</div>
      </div>
    </div>
  );
}

// ── Not staff (a client-portal account signed in to the staff app) ───────────
// Deliberately does NOT sign out on mount — the account is legitimate, just for
// the other app, so the user needs to read where to go before the session ends.
function NotStaff({ user }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">
          <img className="login-logo-img" src="/logo.png" alt="King Universal" />
        </div>
        <div className="login-sub">Operations Platform · Staff access only</div>
        <div className="login-note">
          This is the King Universal staff portal. Client access is at{' '}
          <a href="https://kui.vessl.io" style={{color:'var(--accent)',fontWeight:500}}>kui.vessl.io</a>.
        </div>
        <div className="login-note">You are signed in as <strong>{user?.email||'—'}</strong>.</div>
        <button className="btn-login" onClick={()=>SB.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}

// ── Reset Password (recovery link landing) ───────────────────────────────────
function ResetPassword({ onDone }) {
  const [p1,   setP1]   = useState('');
  const [p2,   setP2]   = useState('');
  const [err,  setErr]  = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr('');
    if (p1.length < 8) return setErr('Password must be at least 8 characters.');
    if (p1 !== p2)     return setErr('Passwords do not match.');
    setBusy(true);
    const { error } = await SB.auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) return setErr(error.message);
    // Clears the recovery tokens from the URL. The fragment is REBUILT from
    // pageFromHash rather than carried across verbatim: at this moment it still
    // reads #access_token=...&type=recovery, and preserving that would put a live
    // credential back into the address bar and the history entry. pageFromHash
    // can only ever return an allow-listed page id, so nothing token-shaped can
    // survive this line -- while a real tab fragment still does.
    try {
      const keep = pageFromHash();
      window.history.replaceState({}, '', window.location.pathname + (keep ? '#'+keep : ''));
    } catch(e){}
    onDone();
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">
          <img className="login-logo-img" src="/logo.png" alt="King Universal" />
        </div>
        <div className="login-sub">Operations Platform · Choose a new password</div>
        <input className="login-field" type="password" placeholder="New password" value={p1} onChange={e=>setP1(e.target.value)} />
        <input className="login-field" type="password" placeholder="Confirm new password" value={p2} onChange={e=>setP2(e.target.value)} onKeyDown={e=>e.key==='Enter'&&save()} />
        <button className="btn-login" onClick={save} disabled={busy}>{busy?'Saving…':'Set new password'}</button>
        <div className="login-error">{err}</div>
      </div>
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color='#C6C6C8', w=72, h=24 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v,i) => [ (i/(data.length-1))*w, h - ((v-min)/range)*(h-3) - 1.5 ]);
  const d = pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  return (
    <svg width={w} height={h} viewBox={'0 0 '+w+' '+h} style={{display:'block'}} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [
        { data: sos },
        { data: pos },
        { data: ships },
      ] = await Promise.all([
        SB.from('sales_orders').select('id,so_number,client_po_number,status,currency,order_date,client_company_id,client:companies!client_company_id(name),sales_order_items(quantity,client_price),sales_order_pos(purchase_orders(purchase_order_items(quantity,unit_price))),order_costs(amount)').order('created_at',{ascending:false}).limit(200),
        SB.from('purchase_orders').select('id,order_number,client_po_number,status').not('status','in','("closed","cancelled")'),
        SB.from('shipments').select('*,companies!client_company_id(name),shipment_pos(purchase_orders(client_po_number,order_number,status,client:companies!client_company_id(name)))').order('created_at',{ascending:false}).limit(40),
      ]);
      // A shipment is "done" if its own status is terminal, OR it has actually arrived,
      // OR its linked PO/SO is already delivered/closed (covers status-sync gaps).
      const TERMINAL = ['delivered','cancelled','closed'];
      const SO_TERMINAL = ['delivered','invoiced','closed','cancelled'];
      const shipIsDone = (s) => {
        if (TERMINAL.includes((s.status||'').toLowerCase())) return true;
        if (s.actual_arrival) return true;
        const linkedPO = s.shipment_pos?.[0]?.purchase_orders;
        if (linkedPO && SO_TERMINAL.includes((linkedPO.status||'').toLowerCase())) return true;
        return false;
      };
      const shipList = (ships||[]).filter(s => !shipIsDone(s)).slice(0,20);

      const soList = sos || [];
      const poList = pos || [];

      // ── per-SO metrics ────────────────────────────────────────────────
      const enriched = soList.map(so => {
        const rev = (so.sales_order_items||[]).reduce((a,i)=>a+(Number(i.quantity)||0)*(Number(i.client_price)||0),0);
        const factoryCost = (so.sales_order_pos||[]).reduce((a,l)=>a+((l.purchase_orders?.purchase_order_items)||[]).reduce((b,i)=>b+(Number(i.quantity)||0)*(Number(i.unit_price)||0),0),0);
        const addlCost = (so.order_costs||[]).reduce((a,c)=>a+(Number(c.amount)||0),0);
        const cost = factoryCost + addlCost;
        const gross = rev - cost;
        const mgn = rev > 0 ? gross / rev * 100 : null;
        return { ...so, rev, cost, gross, mgn };
      });

      // ── pipeline stages ───────────────────────────────────────────────
      const SO_STAGES = ['received','confirmed','in_production','shipped','delivered','invoiced'];
      const pipeline = {};
      SO_STAGES.forEach(s => { pipeline[s] = { count:0, value:0 }; });
      enriched.forEach(so => {
        if (so.status && pipeline[so.status] !== undefined && !['closed'].includes(so.status)) {
          pipeline[so.status].count++;
          pipeline[so.status].value += so.rev;
        }
      });

      // ── headline metrics ──────────────────────────────────────────────
      const open = enriched.filter(so => !['closed','delivered','invoiced'].includes(so.status));
      const pipeline_value = open.reduce((a,so)=>a+so.rev,0);
      const open_cost = open.reduce((a,so)=>a+so.cost,0);
      const open_gross = open.reduce((a,so)=>a+so.gross,0);
      const open_units = open.reduce((a,so)=>a+(so.sales_order_items||[]).reduce((b,i)=>b+(Number(i.quantity)||0),0),0);
      const closedMTD = enriched.filter(so => so.order_date >= monthStart.slice(0,10) && ['delivered','invoiced','closed'].includes(so.status));
      const rev_mtd = closedMTD.reduce((a,so)=>a+so.rev,0);
      const withMargin = enriched.filter(so=>so.mgn!==null && so.rev>0 && !['closed'].includes(so.status));
      const avg_mgn = withMargin.length > 0 ? withMargin.reduce((a,so)=>a+so.mgn,0)/withMargin.length : null;
      const blended_mgn = pipeline_value > 0 ? open_gross / pipeline_value * 100 : null;
      const in_prod = poList.filter(p=>p.status==='in_production').length;
      const in_transit_count = shipList.length;
      const open_count = open.length;
      const active_clients = new Set(open.map(so=>so.client?.name).filter(Boolean)).size;
      // overdue shipments (ETA in the past, not yet arrived, still active)
      const overdue_ships = shipList.filter(s=>{ if(!s.estimated_arrival||s.actual_arrival) return false; return new Date(s.estimated_arrival) < new Date(); }).length;

      // ── client breakdown ──────────────────────────────────────────────
      const clientMap = {};
      enriched.filter(so=>!['closed'].includes(so.status)).forEach(so => {
        const name = so.client?.name || 'Unknown';
        if (!clientMap[name]) clientMap[name] = 0;
        clientMap[name] += so.rev;
      });
      const clients = Object.entries(clientMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

      // ── recent open SOs ───────────────────────────────────────────────
      const recentSOs = enriched.filter(so=>!['closed'].includes(so.status)).slice(0,8);

      // ── 6-month trend (order value by month, for sparklines) ───────────
      const months = [];
      for (let i=5;i>=0;i--){ const dt=new Date(now.getFullYear(),now.getMonth()-i,1); months.push({ key:dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0'), rev:0, units:0, count:0 }); }
      const mIndex = {}; months.forEach((m,i)=>mIndex[m.key]=i);
      enriched.forEach(so => {
        if (!so.order_date) return;
        const k = so.order_date.slice(0,7);
        if (mIndex[k]!==undefined){ months[mIndex[k]].rev += so.rev; months[mIndex[k]].units += (so.sales_order_items||[]).reduce((b,it)=>b+(Number(it.quantity)||0),0); months[mIndex[k]].count++; }
      });
      const revTrend = months.map(m=>m.rev);
      const unitTrend = months.map(m=>m.units);
      const countTrend = months.map(m=>m.count);
      const trendDelta = (arr) => { const a=arr[arr.length-2]||0, b=arr[arr.length-1]||0; if(a===0) return b>0?100:0; return Math.round((b-a)/a*100); };

      setData({ pipeline, pipeline_value, open_cost, open_gross, open_units, rev_mtd, avg_mgn, blended_mgn, in_prod, in_transit_count, open_count, active_clients, overdue_ships, clients, recentSOs, shipList, revTrend, unitTrend, countTrend, revDelta:trendDelta(revTrend), unitDelta:trendDelta(unitTrend), countDelta:trendDelta(countTrend) });
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',flexDirection:'column',gap:'14px'}}>
      <div style={{width:'32px',height:'32px',borderRadius:'50%',border:'3px solid var(--line)',borderTopColor:'var(--accent)',animation:'spin 0.7s linear infinite'}} />
      <div style={{fontSize:'13px',color:'var(--muted)'}}>Loading dashboard…</div>
    </div>
  );

  const { pipeline, pipeline_value, open_cost, open_gross, open_units, rev_mtd, avg_mgn, blended_mgn, in_prod, in_transit_count, open_count, active_clients, overdue_ships, clients, recentSOs, shipList, revTrend, unitTrend, countTrend, revDelta, unitDelta, countDelta } = data;
  const maxClientVal = clients[0]?.[1] || 1;
  const totalPipelineVal = Object.values(pipeline).reduce((a,s)=>a+s.value,0) || 1;
  const SO_STAGES = ['received','confirmed','in_production','shipped','delivered','invoiced'];
  const STAGE_LABELS = { received:'Received', confirmed:'Confirmed', in_production:'In Production', shipped:'Shipped', delivered:'Delivered', invoiced:'Invoiced' };
  const STAGE_COLORS = { received:'#AF52DE', confirmed:'#0071E3', in_production:'#FF9F0A', shipped:'#5AC8FA', delivered:'#30B050', invoiced:'#8E8E93' };

  const DeltaPill = ({ v }) => {
    if (v===undefined||v===null) return null;
    const up = v>=0; const flat = v===0;
    const c = flat?'#86868B':up?'#1A7F45':'#C0392B'; const bg = flat?'#F2F2F2':up?'#E8F6EE':'#FBECEA';
    return <span style={{display:'inline-flex',alignItems:'center',gap:'2px',fontSize:'11px',fontWeight:600,color:c,background:bg,borderRadius:'6px',padding:'2px 6px',fontVariantNumeric:'tabular-nums'}}>{flat?'·':up?'↑':'↓'} {Math.abs(v)}%</span>;
  };

  return (
    <div className="db-apple" style={{padding:'34px 32px 80px',background:'#F5F5F7',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>

      {/* ── Header ── */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'20px',marginBottom:'30px',flexWrap:'wrap'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#0A84FF'}}/><span style={{fontSize:'11px',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'#86868B'}}>{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</span></div>
          <div style={{fontSize:'32px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.032em',lineHeight:1.02}}>Overview</div>
          <div style={{fontSize:'15px',color:'#86868B',marginTop:'7px',letterSpacing:'-.01em'}}>{open_count} open orders · {active_clients} active clients</div>
        </div>
        <button onClick={()=>navigate('sales-orders')} style={{background:'#0066CC',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 18px',fontSize:'14px',fontWeight:500,letterSpacing:'-.01em',cursor:'pointer'}}>View orders</button>
      </div>

      {/* ── Hero + KPI row ── */}
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.15fr) minmax(0,2fr)',gap:'20px',marginBottom:'20px'}} className="db-apple-hero">
        {/* Hero: pipeline value */}
        <div onClick={()=>navigate('sales-orders')} style={{background:'linear-gradient(160deg,#1D1D1F 0%,#2C2C2E 100%)',borderRadius:'20px',padding:'26px 26px 24px',cursor:'pointer',boxShadow:'0 1px 3px rgba(0,0,0,.06)',position:'relative',overflow:'hidden'}}>
          <div style={{fontSize:'13px',color:'rgba(255,255,255,.55)',fontWeight:500,letterSpacing:'-.006em',marginBottom:'16px'}}>Open pipeline value</div>
          <div style={{fontSize:'44px',fontWeight:600,color:'#fff',letterSpacing:'-.03em',lineHeight:.95,fontVariantNumeric:'tabular-nums'}}>{moneyCompact(pipeline_value)}</div>
          <div style={{display:'flex',alignItems:'center',gap:'14px',marginTop:'18px'}}>
            <div style={{flex:1}}><Sparkline data={revTrend} color="rgba(255,255,255,.4)" w={120} h={26} /></div>
            <div style={{fontSize:'12.5px',color:'rgba(255,255,255,.5)',letterSpacing:'-.006em',whiteSpace:'nowrap'}}>{open_count} open orders</div>
          </div>
        </div>
        {/* KPI grid */}
        <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
          <div className="db-apple-kpis" style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',height:'100%'}}>
            {[
              { k:'Units open', v:fmtNum(open_units), spark:unitTrend, accent:'#0066CC' },
              { k:'Open orders', v:String(open_count), spark:countTrend, accent:'#5E5CE6' },
              { k:'In production', v:String(in_prod), accent:'#FF9F0A' },
              { k:'In transit', v:String(in_transit_count), alert:overdue_ships>0?overdue_ships+' overdue':null, accent:overdue_ships>0?'#D14343':'#30B050' },
            ].map((m,i) => (
              <div key={m.k} style={{padding:'20px 22px',borderLeft:(i%2===1)?'1px solid rgba(0,0,0,.06)':'none',borderTop:(i>=2)?'1px solid rgba(0,0,0,.06)':'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:'7px',marginBottom:'13px'}}>
                  <span style={{width:'6px',height:'6px',borderRadius:'50%',background:m.accent,flexShrink:0}} />
                  <span style={{fontSize:'13px',color:'#86868B',fontWeight:400,letterSpacing:'-.006em'}}>{m.k}</span>
                </div>
                <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'10px'}}>
                  <div style={{fontSize:'27px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.026em',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
                  {m.alert ? <span style={{fontSize:'12px',color:'#D14343',fontWeight:500,letterSpacing:'-.006em',paddingBottom:'2px'}}>{m.alert}</span>
                    : m.spark ? <div style={{paddingBottom:'2px'}}><Sparkline data={m.spark} color="#D2D2D4" w={52} h={16} /></div> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pipeline — grouped list with stage accents ── */}
      <div style={{background:'#fff',borderRadius:'20px',marginBottom:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',padding:'20px 24px 16px'}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em'}}>Pipeline by stage</div>
          <div style={{fontSize:'14px',color:'#86868B',letterSpacing:'-.01em',fontVariantNumeric:'tabular-nums'}}>{moneyCompact(totalPipelineVal)} total</div>
        </div>
        <div style={{display:'flex',height:'4px',margin:'0 24px 4px',gap:'2px',borderRadius:'2px',overflow:'hidden'}}>
          {SO_STAGES.map(s => { const pct=pipeline[s].value/totalPipelineVal*100; return pct>0?<div key={s} style={{flex:pct,background:STAGE_COLORS[s]}} title={STAGE_LABELS[s]} />:null; })}
        </div>
        <div>
          {SO_STAGES.map((s) => {
            const active = pipeline[s].count>0;
            const barPct = pipeline[s].value/totalPipelineVal*100;
            return (
              <div key={s} onClick={()=>navigate('sales-orders')} style={{display:'grid',gridTemplateColumns:'150px 1fr auto auto',gap:'18px',alignItems:'center',padding:'13px 24px',borderTop:'1px solid rgba(0,0,0,.06)',cursor:'pointer',transition:'background .12s'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFA'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div style={{display:'flex',alignItems:'center',gap:'9px'}}>
                  <span style={{width:'7px',height:'7px',borderRadius:'50%',background:active?STAGE_COLORS[s]:'#DADADC',flexShrink:0}} />
                  <span style={{fontSize:'15px',color:active?'#1D1D1F':'#B0B0B2',letterSpacing:'-.01em'}}>{STAGE_LABELS[s]}</span>
                </div>
                <div style={{height:'4px',background:'#F0F0F2',borderRadius:'2px',overflow:'hidden',minWidth:0}}>
                  <div style={{height:'100%',width:Math.max(active?4:0,barPct)+'%',background:STAGE_COLORS[s],opacity:active?.85:0,borderRadius:'2px',transition:'width .4s'}} />
                </div>
                <div style={{fontSize:'15px',color:'#86868B',fontVariantNumeric:'tabular-nums',letterSpacing:'-.01em',minWidth:'76px',textAlign:'right'}}>{active?money(pipeline[s].value):'—'}</div>
                <div style={{fontSize:'15px',color:active?'#1D1D1F':'#C0C0C2',fontWeight:active?600:400,fontVariantNumeric:'tabular-nums',minWidth:'26px',textAlign:'right'}}>{pipeline[s].count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Two columns ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:'20px',alignItems:'start'}} className="db-apple-cols">

        {/* Active orders */}
        <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px 16px'}}>
            <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em'}}>Active orders</div>
            <button onClick={()=>navigate('sales-orders')} style={{background:'none',border:'none',color:'#0066CC',fontSize:'14px',fontWeight:400,letterSpacing:'-.01em',cursor:'pointer',padding:0}}>See all</button>
          </div>
          <div>
            {recentSOs.length===0 && <div style={{padding:'20px 24px 28px',color:'#86868B',fontSize:'14px'}}>No active orders.</div>}
            {recentSOs.map((so) => {
              const units=(so.sales_order_items||[]).reduce((b,it)=>b+(Number(it.quantity)||0),0);
              return (
                <div key={so.id} onClick={()=>navigate('so-detail',{id:so.id})} style={{display:'flex',alignItems:'center',gap:'13px',padding:'12px 24px',borderTop:'1px solid rgba(0,0,0,.06)',cursor:'pointer',transition:'background .12s'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFA'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{width:'34px',height:'34px',borderRadius:'9px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11.5px',fontWeight:600,fontFamily:'var(--mono)',color:'#fff',background:companyColor(so.client?.name||''),letterSpacing:'-.01em'}}>{initials(so.client?.name||'?')}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:'15px',fontWeight:500,color:'#1D1D1F',letterSpacing:'-.01em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.client_po_number||so.so_number||'—'}</div>
                    <div style={{fontSize:'13px',color:'#86868B',marginTop:'2px',letterSpacing:'-.006em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.client?.name||'Unknown'} · {fmtNum(units)} units</div>
                  </div>
                  <div style={{fontSize:'15px',fontWeight:500,color:'#1D1D1F',fontVariantNumeric:'tabular-nums',letterSpacing:'-.01em',flexShrink:0}}>{money(so.rev)}</div>
                  <svg width="8" height="13" viewBox="0 0 8 13" fill="none" style={{flexShrink:0}}><path d="M1.5 1.5L6 6.5L1.5 11.5" stroke="#C6C6C8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right rail */}
        <div style={{display:'flex',flexDirection:'column',gap:'20px'}}>

          {/* In transit */}
          <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 22px 15px'}}>
              <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em'}}>In transit</div>
              <span style={{fontSize:'13px',color:overdue_ships>0?'#D14343':'#86868B',letterSpacing:'-.006em'}}>{overdue_ships>0?overdue_ships+' overdue':in_transit_count+' active'}</span>
            </div>
            {shipList.length===0 ? <div style={{padding:'0 22px 24px',color:'#86868B',fontSize:'14px'}}>Nothing in transit.</div> :
              shipList.slice(0,5).map((sh) => {
                const days=etaDays(sh.estimated_arrival); const po=sh.shipment_pos?.[0]?.purchase_orders;
                const ref=po?.client_po_number||po?.order_number||'—'; const overdue=days!==null&&days<0&&!sh.actual_arrival;
                return (
                  <div key={sh.id} onClick={()=>navigate('shipments')} style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px 22px',borderTop:'1px solid rgba(0,0,0,.06)',cursor:'pointer',transition:'background .12s'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFA'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:'14px',fontWeight:500,color:'#1D1D1F',letterSpacing:'-.01em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ref}</div>
                      <div style={{fontSize:'12.5px',color:'#86868B',marginTop:'2px',letterSpacing:'-.006em'}}>ETA {fmtDateShort(sh.estimated_arrival)}</div>
                    </div>
                    {days!==null && <div style={{fontSize:'14px',fontWeight:500,color:overdue?'#D14343':'#1D1D1F',fontVariantNumeric:'tabular-nums',letterSpacing:'-.01em',flexShrink:0}}>{overdue?Math.abs(days)+'d':days+'d'}</div>}
                  </div>
                );
              })}
          </div>

          {/* Top clients */}
          <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
            <div style={{padding:'20px 22px 15px'}}>
              <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em'}}>Top clients</div>
            </div>
            {clients.length===0 && <div style={{padding:'0 22px 24px',color:'#86868B',fontSize:'14px'}}>No data.</div>}
            {clients.map(([name,val]) => (
              <div key={name} style={{padding:'12px 22px',borderTop:'1px solid rgba(0,0,0,.06)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',marginBottom:'8px'}}>
                  <span style={{fontSize:'14px',color:'#1D1D1F',letterSpacing:'-.01em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{name}</span>
                  <span style={{fontSize:'13px',color:'#86868B',fontVariantNumeric:'tabular-nums',letterSpacing:'-.006em',flexShrink:0}}>{moneyCompact(val)}</span>
                </div>
                <div style={{height:'3px',background:'#F0F0F2',borderRadius:'2px',overflow:'hidden'}}>
                  <div style={{height:'100%',width:(maxClientVal>0?val/maxClientVal*100:0)+'%',background:companyColor(name),opacity:.9,borderRadius:'2px'}} />
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Inventory ─────────────────────────────────────────────────────────────────
// ── Inventory ─────────────────────────────────────────────────────────────────
function Inventory() {
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshed, setRefreshed] = useState(null);
  const load = async () => {
    setLoading(true);
    const { data: pos } = await SB.from('purchase_orders')
      .select('id,order_number,client_po_number,status,client:companies!client_company_id(name,id),purchase_order_items(description,quantity,products(name,sku)),shipment_pos(shipments(status,actual_arrival))')
      .not('status','in','("draft","cancelled","closed","delivered")');
    const active = (pos||[]).filter(po => {
      const ships = (po.shipment_pos||[]).map(sp=>sp.shipments).filter(Boolean);
      return !ships.some(s=>s?.actual_arrival || ['delivered'].includes(s?.status));
    });
    const g = {};
    active.forEach(po=>{
      const cName = po.client?.name||'Unassigned';
      if (!g[cName]) g[cName] = { products:{} };
      (po.purchase_order_items||[]).forEach(it=>{
        const prod = it.products?.name||it.description||'—';
        const sku  = it.products?.sku||'';
        const k = prod+'|||'+sku;
        if (!g[cName].products[k]) g[cName].products[k] = { prod, sku, qty:0, orders:[] };
        g[cName].products[k].qty  += Number(it.quantity)||0;
        g[cName].products[k].orders.push({ num:po.client_po_number||po.order_number||po.id.slice(0,8), status:po.status });
      });
    });
    setGroups(g); setRefreshed(new Date()); setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  if (loading) return <div style={{padding:'60px',textAlign:'center',color:'#86868B',fontSize:'14px'}}>Loading inventory…</div>;

  const clients = Object.keys(groups).sort((a,b)=>{
    const av=Object.values(groups[a].products).reduce((x,p)=>x+p.qty,0);
    const bv=Object.values(groups[b].products).reduce((x,p)=>x+p.qty,0);
    return bv-av;
  });
  const clientQty = c => Object.values(groups[c].products).reduce((a,p)=>a+p.qty,0);
  const totalUnits = clients.reduce((a,c)=>a+clientQty(c),0);
  const totalSkus  = clients.reduce((a,c)=>a+Object.keys(groups[c].products).length,0);
  const maxUnits   = Math.max(1,...clients.map(clientQty));

  const cardShadow = '0 1px 3px rgba(0,0,0,.04)';

  return (
    <div className="db-apple" style={{padding:'34px 32px 80px',background:'#F5F5F7',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>

      {/* ── Header ── */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'20px',marginBottom:'30px',flexWrap:'wrap'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#BF5AF2'}}/><span style={{fontSize:'11px',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'#86868B'}}>Stock &amp; Production</span></div>
          <div style={{fontSize:'32px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.032em',lineHeight:1.02}}>Inventory</div>
          <div style={{fontSize:'15px',color:'#86868B',marginTop:'7px',letterSpacing:'-.01em'}}>Units on order across live production · updated {refreshed?.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
        </div>
        <button onClick={load} style={{background:'#fff',color:'#1D1D1F',border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'9px 18px',fontSize:'14px',fontWeight:500,letterSpacing:'-.01em',cursor:'pointer'}}>Refresh</button>
      </div>

      {clients.length===0 ? (
        <div style={{background:'#fff',borderRadius:'20px',padding:'56px 32px',textAlign:'center',boxShadow:cardShadow}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',marginBottom:'7px',letterSpacing:'-.018em'}}>Inventory is empty</div>
          <div style={{color:'#86868B',fontSize:'14px'}}>Live purchase orders appear here automatically. Counts clear once a shipment is delivered.</div>
        </div>
      ) : (
      <>
        {/* ── Summary tiles ── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'20px',marginBottom:'20px'}} className="inv-summary">
          {[
            { k:'Total units on order', v:fmtNum(totalUnits), sub:'across all clients' },
            { k:'Active SKUs', v:fmtNum(totalSkus), sub:'unique products' },
            { k:'Active clients', v:String(clients.length), sub:'with live orders' },
          ].map(m=>(
            <div key={m.k} style={{background:'#fff',borderRadius:'20px',padding:'22px 24px',boxShadow:cardShadow}}>
              <div style={{fontSize:'13px',color:'#86868B',fontWeight:400,letterSpacing:'-.006em',marginBottom:'14px'}}>{m.k}</div>
              <div style={{fontSize:'34px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.03em',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
              <div style={{fontSize:'13px',color:'#A0A0A4',marginTop:'8px',letterSpacing:'-.006em'}}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Units by client bar chart ── */}
        <div style={{background:'#fff',borderRadius:'20px',boxShadow:cardShadow,padding:'22px 24px 20px',marginBottom:'20px'}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em',marginBottom:'20px'}}>Units on order by client</div>
          {clients.map((c)=>{
            const qty=clientQty(c); const pct=qty/maxUnits*100;
            return (
              <div key={c} style={{display:'flex',alignItems:'center',gap:'14px',marginBottom:'13px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'9px',width:'150px',flexShrink:0,minWidth:0}}>
                  <span style={{width:'22px',height:'22px',borderRadius:'6px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:600,fontFamily:'var(--mono)',color:'#fff',background:companyColor(c)}}>{initials(c)}</span>
                  <span style={{fontSize:'14px',color:'#1D1D1F',letterSpacing:'-.01em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c}</span>
                </div>
                <div style={{flex:1,height:'8px',background:'#F0F0F2',borderRadius:'4px',overflow:'hidden',minWidth:0}}>
                  <div style={{height:'100%',width:pct+'%',background:companyColor(c),opacity:.9,borderRadius:'4px',minWidth:qty>0?'4px':'0',transition:'width .45s'}} />
                </div>
                <span style={{fontSize:'14px',fontWeight:500,color:'#1D1D1F',width:'62px',textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums',letterSpacing:'-.01em'}}>{fmtNum(qty)}</span>
              </div>
            );
          })}
        </div>

        {/* ── Per-client product tables ── */}
        {clients.map((c)=>{
          const rows = Object.values(groups[c].products).sort((a,b)=>b.qty-a.qty);
          const total = clientQty(c);
          return (
            <div key={c} style={{background:'#fff',borderRadius:'20px',boxShadow:cardShadow,overflow:'hidden',marginBottom:'20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 24px 16px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'11px',minWidth:0}}>
                  <span style={{width:'30px',height:'30px',borderRadius:'8px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:600,fontFamily:'var(--mono)',color:'#fff',background:companyColor(c)}}>{initials(c)}</span>
                  <span style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c}</span>
                </div>
                <span style={{fontSize:'14px',color:'#86868B',fontVariantNumeric:'tabular-nums',letterSpacing:'-.01em',flexShrink:0}}>{fmtNum(total)} units</span>
              </div>
              {/* column header */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 130px 90px',gap:'16px',padding:'9px 24px',borderTop:'1px solid rgba(0,0,0,.06)',background:'#FAFAFA'}}>
                <div style={{fontSize:'11px',fontWeight:500,letterSpacing:'-.004em',color:'#A0A0A4'}}>Product</div>
                <div style={{fontSize:'11px',fontWeight:500,letterSpacing:'-.004em',color:'#A0A0A4'}}>SKU</div>
                <div style={{fontSize:'11px',fontWeight:500,letterSpacing:'-.004em',color:'#A0A0A4',textAlign:'right'}}>On order</div>
              </div>
              {rows.map((p,i)=>(
                <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 130px 90px',gap:'16px',padding:'13px 24px',borderTop:'1px solid rgba(0,0,0,.06)',alignItems:'center'}}>
                  <div style={{fontSize:'15px',color:'#1D1D1F',letterSpacing:'-.01em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.prod}</div>
                  <div style={{fontSize:'13px',color:'#86868B',fontFamily:'var(--mono)',letterSpacing:'-.006em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.sku||'—'}</div>
                  <div style={{fontSize:'15px',fontWeight:600,color:'#1D1D1F',textAlign:'right',fontVariantNumeric:'tabular-nums',letterSpacing:'-.01em'}}>{fmtNum(p.qty)}</div>
                </div>
              ))}
            </div>
          );
        })}
      </>
      )}
    </div>
  );
}

// ── Sales Orders ─────────────────────────────────────────────────────────────
function SOBadge({status}){
  const m=SO_SM[status]||{label:(status||'—').replace(/_/g,' '),color:'#64748b',bg:'#f8fafc'};
  return <span style={{display:'inline-flex',alignItems:'center',padding:'3px 9px',borderRadius:'20px',fontSize:'10px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',background:m.bg,color:m.color,whiteSpace:'nowrap'}}>{m.label}</span>;
}

function SOCard({so,onClick}){
  const {rev,cost,mgn}=soMetrics(so);
  const cl=so.client?.name||'—'; const mc=mgnColor(mgn);
  return (
    <div className="order-card" onClick={onClick} style={{cursor:'pointer'}}>
      <div className="oc-top">
        <span style={{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:700,color:'var(--ink)'}}>{so.client_po_number||so.so_number||'—'}</span>
        <SOBadge status={so.status} />
      </div>
      <div className="oc-factory">
        <span className="oc-avatar" style={{background:companyColor(cl)}}>{initials(cl)}</span>
        <span style={{display:'flex',flexDirection:'column',gap:'2px',minWidth:0,overflow:'hidden'}}>
          <span style={{fontWeight:700,fontSize:'14px',color:'var(--ink)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{cl}</span>
          {so.so_number && false && <span style={{fontSize:'11px',color:'var(--muted)'}}>{'Internal: '+so.so_number}</span>}
        </span>
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 4px'}}>
        <span style={{fontFamily:'var(--mono)',fontSize:'14px',fontWeight:700,color:'var(--ink)'}}>{rev>0?money(rev,so.currency):'No items'}</span>
        {mgn!==null && <span style={{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:700,color:mc,background:mc+'22',padding:'2px 8px',borderRadius:'12px'}}>{mgn.toFixed(1)+'%'}</span>}
      </div>
      {(so.required_ship_date||so.cargo_ready_date||cost>0) && (
        <div style={{padding:'2px 16px 12px',fontSize:'11px',color:'var(--muted)',display:'flex',gap:'14px',flexWrap:'wrap'}}>
          {so.cargo_ready_date && <span style={{color:'var(--accent)',fontWeight:600}}>{'CRD '+fmtDate(so.cargo_ready_date)}</span>}
          {so.required_ship_date && <span>{'Ship by '+fmtDate(so.required_ship_date)}</span>}
          {cost>0 && <span>{'Cost: '+money(cost,so.currency)}</span>}
        </div>
      )}
    </div>
  );
}

function SalesOrders({navigate}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [statusF,setStatusF]=useState('all');
  const [clientF,setClientF]=useState('all');
  const [showCreate,setShowCreate]=useState(false);
  const load=async()=>{ setLoading(true); const {data}=await SB.from('sales_orders').select('*,client:companies!client_company_id(id,name),sales_order_items(quantity,client_price),sales_order_pos(purchase_orders(purchase_order_items(unit_price,quantity))),order_costs(amount,kind)').order('created_at',{ascending:false}); setRows(data||[]); setLoading(false); };
  useEffect(()=>{ load(); },[]);
  const clients=[...new Set(rows.map(r=>r.client?.name).filter(Boolean))].sort();
  const shown=rows.filter(r=>{
    if(statusF!=='all'&&r.status!==statusF) return false;
    if(clientF!=='all'&&r.client?.name!==clientF) return false;
    if(search){ const q=search.toLowerCase(); return (r.so_number||'').toLowerCase().includes(q)||(r.client_po_number||'').toLowerCase().includes(q)||(r.client?.name||'').toLowerCase().includes(q); }
    return true;
  });
  const totals=shown.reduce((a,so)=>{ const m=soMetrics(so); return {rev:a.rev+m.rev,cost:a.cost+m.cost,n:a.n+1}; },{rev:0,cost:0,n:0});
  const totalMgn=totals.rev>0?(totals.rev-totals.cost)/totals.rev*100:null;
  const totalUnits = shown.reduce((a,so)=>a+(so.sales_order_items||[]).reduce((b,i)=>b+(Number(i.quantity)||0),0),0);
  const clientOptions = [
    { value:'all', label:'All Clients' },
    ...clients.map(c=>({ value:c, label:c, color:companyColor(c) })),
  ];
  const statusOptions = [
    { value:'all', label:'All Statuses' },
    ...SO_STATUSES.map(s=>{ const m=SO_SM[s]; return { value:s, label:(m&&m.label)||s.replace(/_/g,' '), color:m&&m.color, bg:m&&m.bg }; }),
  ];
  return (
    <div className="db-wrap" style={{padding:'26px 28px 72px',background:'#FBFBFD',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>
      {showCreate && <CreateSOModal onClose={()=>setShowCreate(false)} onCreated={(id)=>{setShowCreate(false);id?navigate('so-detail',{id}):load();}} />}

      {/* Title */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'22px',gap:'14px',flexWrap:'wrap'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#30D158'}}/><span style={{fontSize:'11px',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'#86868B'}}>Revenue Pipeline</span></div>
          <div style={{fontSize:'32px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.032em',lineHeight:1.02}}>Sales Orders</div>
          <div style={{fontSize:'14px',color:'#86868B',marginTop:'7px',letterSpacing:'-.01em'}}>Client POs received by KUI</div>
        </div>
        <button onClick={()=>setShowCreate(true)} style={{display:'inline-flex',alignItems:'center',gap:'7px',background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',flexShrink:0,boxShadow:'0 1px 2px rgba(0,0,0,.08)'}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Sales Order
        </button>
      </div>

      {/* Summary tiles */}
      {shown.length>0 && (
        <div className="db-kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'14px',marginBottom:'16px'}}>
          {[
            { k:'Orders', v:String(totals.n), tint:'#5856D6', bg:'#EEEEFC', icon:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8' },
            { k:'Pipeline revenue', v:moneyCompact(totals.rev), tint:'#0071E3', bg:'#EAF3FE', icon:'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
            { k:'Total units', v:fmtNum(totalUnits), tint:'#FF9500', bg:'#FFF3E2', icon:'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.3 7L12 12l8.7-5 M12 22V12' },
          ].map(m => (
            <div key={m.k} style={{background:'#fff',borderRadius:'18px',padding:'18px 20px',boxShadow:'0 0 0 1px rgba(0,0,0,.03), 0 2px 5px rgba(0,0,0,.04), 0 12px 28px -8px rgba(20,20,40,.06)'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'14px'}}>
                <div style={{width:'34px',height:'34px',borderRadius:'10px',background:m.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={m.tint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{m.icon.split(' M').map((seg,si)=><path key={si} d={(si>0?'M':'')+seg} />)}</svg>
                </div>
                <div style={{fontSize:'12.5px',fontWeight:500,color:'#8A8A8E'}}>{m.k}</div>
              </div>
              <div style={{fontSize:'28px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.025em',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{display:'flex',alignItems:'center',gap:'10px',background:'#fff',borderRadius:'12px',padding:'0 14px',height:'44px',marginBottom:'12px',boxShadow:'0 0 0 1px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.04)'}}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8A8A8E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input placeholder="Search by client PO or client name…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,border:'none',outline:'none',background:'transparent',fontSize:'14px',color:'#1A1A1C',minWidth:0}} />
        {search && <button onClick={()=>setSearch('')} style={{flexShrink:0,width:'20px',height:'20px',borderRadius:'50%',border:'none',background:'#F0F0F2',color:'#8A8A8E',fontSize:'14px',lineHeight:1,cursor:'pointer'}}>×</button>}
      </div>

      {/* Client + status filters */}
      <div className="fs-row" style={{marginBottom:'18px'}}>
        {clients.length>1 && (
          <FilterSelect label="All Clients" value={clientF} onChange={setClientF} options={clientOptions} />
        )}
        <FilterSelect label="All Statuses" value={statusF} onChange={setStatusF} options={statusOptions} />
      </div>

      {/* Orders — distinct 2-col card grid */}
      {loading ? (
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'60px',color:'#8A8A8E',fontSize:'14px'}}>Loading…</div>
      ) : shown.length ? (
        <div className="so-card-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:'14px'}}>
          {shown.map((so) => {
            const m=soMetrics(so);
            const units=(so.sales_order_items||[]).reduce((b,it)=>b+(Number(it.quantity)||0),0);
            const sm=SO_SM[so.status]||{label:so.status,color:'#8A8A8E'};
            const stageIdx=SO_STATUSES.indexOf(so.status);
            const pct=stageIdx>=0?Math.round((stageIdx/(SO_STATUSES.length-1))*100):0;
            return (
              <div key={so.id} onClick={()=>navigate('so-detail',{id:so.id})} style={{position:'relative',background:'#fff',borderRadius:'16px',padding:'0',cursor:'pointer',overflow:'hidden',boxShadow:'0 0 0 1px rgba(0,0,0,.03), 0 2px 5px rgba(0,0,0,.04), 0 12px 28px -8px rgba(20,20,40,.06)',transition:'.14s'}} onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 0 0 1px rgba(0,0,0,.04), 0 6px 14px rgba(0,0,0,.06), 0 20px 40px -10px rgba(20,20,40,.12)';}} onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 0 0 1px rgba(0,0,0,.03), 0 2px 5px rgba(0,0,0,.04), 0 12px 28px -8px rgba(20,20,40,.06)';}}>
                {/* accent stripe */}
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:'4px',background:sm.color}} />
                <div style={{padding:'18px 20px 16px 22px'}}>
                  {/* header */}
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'12px',marginBottom:'14px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'11px',minWidth:0}}>
                      <div style={{width:'38px',height:'38px',borderRadius:'10px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12.5px',fontWeight:600,fontFamily:'var(--mono)',color:'#fff',background:companyColor(so.client?.name||'')}}>{initials(so.client?.name||'?')}</div>
                      <div style={{minWidth:0}}>
                        <div style={{fontFamily:'var(--mono)',fontSize:'14.5px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.client_po_number||so.so_number||'—'}</div>
                        <div style={{fontSize:'12px',color:'#8A8A8E',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{so.client?.name||'Unknown'}</div>
                      </div>
                    </div>
                    <Badge status={so.status} />
                  </div>
                  {/* progress bar */}
                  <div style={{marginBottom:'14px'}}>
                    <div style={{height:'5px',background:'#F0F0F2',borderRadius:'3px',overflow:'hidden'}}>
                      <div style={{height:'100%',width:pct+'%',background:sm.color,borderRadius:'3px',transition:'width .4s'}} />
                    </div>
                    <div style={{fontSize:'10.5px',color:'#A0A0A4',marginTop:'6px',textTransform:'uppercase',letterSpacing:'.05em'}}>{sm.label}</div>
                  </div>
                  {/* footer stats */}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',paddingTop:'13px',borderTop:'1px solid #F2F2F4'}}>
                    <div>
                      <div style={{fontSize:'10px',color:'#A0A0A4',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'2px'}}>Units</div>
                      <div style={{fontSize:'14px',fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{fmtNum(units)}</div>
                    </div>
                    <div style={{textAlign:'center'}}>
                      <div style={{fontSize:'10px',color:'#A0A0A4',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'2px'}}>Ordered</div>
                      <div style={{fontSize:'13px',fontWeight:500,color:'#4A4A4E'}}>{so.order_date?fmtDateShort(so.order_date):'—'}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'10px',color:'#A0A0A4',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'2px'}}>Value</div>
                      <div style={{fontSize:'15px',fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(m.rev)}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{background:'#fff',borderRadius:'18px',boxShadow:'0 0 0 1px rgba(0,0,0,.03), 0 2px 5px rgba(0,0,0,.04), 0 12px 28px -8px rgba(20,20,40,.06)',padding:'56px 32px',textAlign:'center'}}>
          <div style={{width:'52px',height:'52px',borderRadius:'14px',background:'#F2F2F6',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div style={{fontSize:'16px',fontWeight:600,color:'#1A1A1C',marginBottom:'8px'}}>{'No sales orders'+(statusF!=='all'?' with this status':'')}</div>
          <div style={{color:'#8A8A8E',fontSize:'13.5px',marginBottom:'22px',lineHeight:1.6,maxWidth:'340px',marginLeft:'auto',marginRight:'auto'}}>Sales orders are client POs received by KUI. Create one to start tracking.</div>
          <button onClick={()=>setShowCreate(true)} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>New Sales Order</button>
        </div>
      )}
    </div>
  );
}

function SalesOrderDetail({id,navigate}){
  const [so,setSo]=useState(null);
  const [items,setItems]=useState([]);
  const [linkedPos,setLinkedPos]=useState([]);
  const [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const [invoiceNum,setInvoiceNum]=useState('');
  const [savingInv,setSavingInv]=useState(false);
  const [costs,setCosts]=useState([]);
  const [shipment,setShipment]=useState(null);
  const load=async()=>{
    setLoading(true);
    const [{data:soD},{data:itmD,error:itmErr},{data:posD,error:posErr},{data:costD}]=await Promise.all([
      SB.from('sales_orders').select('*,client:companies!client_company_id(id,name,vendor_number)').eq('id',id).single(),
      SB.from('sales_order_items').select('*').eq('sales_order_id',id),
      SB.from('sales_order_pos').select('purchase_orders(id,order_number,client_po_number,status,currency,factory_company_id,purchase_order_items(description,quantity,unit_price))').eq('sales_order_id',id),
      SB.from('order_costs').select('*').eq('sales_order_id',id).order('created_at'),
    ]);
    if(itmErr) console.error('SO items load error:', itmErr);
    if(posErr) console.error('SO linked-PO load error:', posErr);
    setSo(soD); setItems(itmD||[]); setInvoiceNum(soD?.invoice_number||''); setCosts(costD||[]);
    let pos=(posD||[]).map(p=>p.purchase_orders).filter(Boolean);
    // Resolve factory names separately so a join failure can't blank the PO list
    const facIds=[...new Set(pos.map(p=>p.factory_company_id).filter(Boolean))];
    if(facIds.length){
      const {data:facs}=await SB.from('companies').select('id,name').in('id',facIds);
      const facMap={}; (facs||[]).forEach(f=>{facMap[f.id]=f.name;});
      pos=pos.map(p=>({...p,companies:{name:facMap[p.factory_company_id]||'—'}}));
    }
    setLinkedPos(pos);
    // Pull the shipment linked to any of this SO's POs (logistics sync)
    let sh=null;
    if(pos.length){
      const poIds=pos.map(p=>p.id);
      const {data:links}=await SB.from('shipment_pos').select('shipment_id').in('purchase_order_id',poIds).limit(1);
      if(links&&links.length){
        let s=null;
        const shipRes=await SB.from('shipments').select('*,origin_port:ports!origin_port_id(name,unlocode),destination_port:ports!destination_port_id(name,unlocode),carrier:companies!carrier_company_id(name)').eq('id',links[0].shipment_id).single();
        s=shipRes.data;
        if(shipRes.error||!s){ const r=await SB.from('shipments').select('*').eq('id',links[0].shipment_id).single(); s=r.data; }
        sh=s;
      }
    }
    setShipment(sh);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[id]);
  if(loading) return <div className="loading">Loading…</div>;
  if(!so) return null;
  const rev=items.reduce((a,i)=>a+(Number(i.quantity)||0)*(Number(i.client_price)||0),0);
  const factoryCost=linkedPos.reduce((a,po)=>a+(po.purchase_order_items||[]).reduce((b,i)=>b+(Number(i.quantity)||0)*(Number(i.unit_price)||0),0),0);
  const addlCost=costs.reduce((a,c)=>a+(Number(c.amount)||0),0);
  const cost=factoryCost+addlCost;
  const gross=rev-cost; const mgn=rev>0?gross/rev*100:null; const mc=mgnColor(mgn);
  const cl=so.client?.name||'—';
  const updateStatus=async s=>{await SB.from('sales_orders').update({status:s,updated_at:new Date().toISOString()}).eq('id',id); setSo(prev=>({...prev,status:s}));};
  const saveInvoice=async()=>{ setSavingInv(true); await SB.from('sales_orders').update({invoice_number:invoiceNum.trim()||null,updated_at:new Date().toISOString()}).eq('id',id); setSo(prev=>({...prev,invoice_number:invoiceNum.trim()||null})); setSavingInv(false); };

  const genSO = () => {
    const win = window.open('', '_blank');
    if (win) win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating order confirmation…</body>');
    const docData = {
      so_ref: so.client_po_number || so.so_number || id.slice(0,8).toUpperCase(),
      client_po: so.client_po_number || '',
      currency: so.currency || 'USD',
      client_name: so.client?.name || '',
      order_date: so.order_date,
      cargo_ready_date: so.cargo_ready_date,
      indc_date: so.indc_date || so.required_ship_date,
      cancel_date: so.cancel_date,
      payment_terms: so.payment_terms || '',
      shipping_method: so.shipping_method || '',
      ship_to: so.delivery_address || '',
      notes: so.notes || '',
      lines: items.map(it => ({
        description: it.description || it.products?.name || '—',
        sku: it.client_sku || it.products?.sku || '',
        size: it.size || '',
        quantity: Number(it.quantity) || 0,
        client_price: Number(it.client_price) || 0,
        line_amount: (Number(it.quantity)||0) * (Number(it.client_price)||0),
      })),
    };
    const html = buildSODoc(docData);
    if (win) { win.document.open(); win.document.write(html); win.document.close(); setTimeout(()=>{ try{ win.focus(); win.print(); }catch(e){} }, 500); }
    else {
      const url = URL.createObjectURL(new Blob([html],{type:'text/html'}));
      const a = document.createElement('a'); a.href=url; a.download='Order-'+(so.client_po_number||id)+'.html';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url), 4000);
    }
  };
  const deleteSO=async()=>{ await SB.from('sales_order_pos').delete().eq('sales_order_id',id); await SB.from('sales_order_items').delete().eq('sales_order_id',id); await SB.from('sales_orders').delete().eq('id',id); navigate('sales-orders'); };
  const unlinkPO=async poId=>{ await SB.from('sales_order_pos').delete().eq('sales_order_id',id).eq('purchase_order_id',poId); setLinkedPos(prev=>prev.filter(p=>p.id!==poId)); };
  return (
    <>
      {editing && <EditSOModal so={so} items={items} linkedPos={linkedPos} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);load();}} />}
      {confirmDel && <ConfirmModal title={'Delete '+(so.client_po_number||so.so_number)+'?'} message="All line items and factory PO links will be removed. This cannot be undone." onConfirm={()=>{setConfirmDel(false);deleteSO();}} onCancel={()=>setConfirmDel(false)} />}
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'20px',flexWrap:'wrap'}}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate('sales-orders')}>{'← Back'}</button>
        <span style={{flex:1}} />
        <button className="btn btn-ghost btn-sm" style={{color:'var(--hot)'}} onClick={()=>setConfirmDel(true)}>Delete</button>
        <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>Edit</button>
        <button className="btn btn-dark btn-sm" onClick={genSO}>Generate Order Confirmation</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px',marginBottom:'22px'}}>
        {[{l:'Revenue',v:money(rev,so.currency),c:'var(--ink)',t:'var(--line-2)'},{l:'Total Cost',v:cost>0?money(cost,so.currency):'No POs linked',c:cost>0?'var(--ink)':'var(--muted)',t:'var(--line-2)'},{l:'Gross Margin',v:gross>0?money(gross,so.currency):'—',c:gross>0?'#059669':'var(--muted)',t:gross>0?'#059669':'var(--line-2)'},{l:'Margin %',v:mgn!==null?mgn.toFixed(1)+'%':'—',c:mc,t:mc}].map(t=>(
          <div key={t.l} className="section-card" style={{padding:'16px 18px',marginBottom:0,borderTop:'3px solid '+t.t}}>
            <div style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'.12em',color:'var(--muted)',marginBottom:'8px'}}>{t.l}</div>
            <div style={{fontFamily:'var(--mono)',fontSize:'22px',fontWeight:700,color:t.c,lineHeight:1}}>{t.v}</div>
          </div>
        ))}
      </div>
      <div className="detail-grid" style={{marginBottom:'20px'}}>
        <div className="section-card" style={{marginBottom:0}}>
          <div style={{padding:'18px 18px 6px'}}>
            <div style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',marginBottom:'12px'}}>Client</div>
            <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'16px'}}>
              <span style={{width:'40px',height:'40px',borderRadius:'10px',background:companyColor(cl),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'13px',fontWeight:700,color:'#fff',flexShrink:0}}>{initials(cl)}</span>
              <div><div style={{fontWeight:700,fontSize:'16px',color:'var(--ink)'}}>{cl}</div>{so.client?.vendor_number&&<div style={{fontSize:'12px',color:'var(--muted)'}}>{'Vendor # '+so.client.vendor_number}</div>}</div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderTop:'1px solid var(--line-2)'}}>
            {[['Client PO #',so.client_po_number||'—'],['Order Date',fmtDate(so.order_date)],['Cargo Ready Date',so.cargo_ready_date?fmtDate(so.cargo_ready_date):'TBD'],['INDC',fmtDate(so.indc_date||so.required_ship_date)],['Cancel Date',so.cancel_date?fmtDate(so.cancel_date):'—'],['Payment',so.payment_terms||'—'],['Shipping Method',so.shipping_method||'—'],['Currency',so.currency||'USD']].map(([l,v],i)=>(
              <div key={l} style={{padding:'12px 18px',borderBottom:i<4?'1px solid var(--line-2)':'none',borderRight:i%2===0?'1px solid var(--line-2)':'none'}}>
                <div style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',marginBottom:'4px'}}>{l}</div>
                <div style={{fontSize:'13px',fontWeight:600,color:'var(--ink)',fontFamily:l.includes('#')?'var(--mono)':'inherit'}}>{v}</div>
              </div>
            ))}
          </div>
          {so.delivery_address && <div className="section-card" style={{marginTop:'12px',padding:'14px 18px'}}>
            <div style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',marginBottom:'6px'}}>Ship-To Address</div>
            <div style={{fontSize:'13px',color:'var(--ink)',lineHeight:1.6,whiteSpace:'pre-line'}}>{so.delivery_address}</div>
          </div>}
        </div>
        <div>
          <div className="section-card" style={{marginBottom:'12px'}}>
            <div style={{padding:'14px 18px 8px',fontSize:'10px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)'}}>Status — tap to change</div>
            <div style={{padding:'0 18px 16px',display:'flex',flexWrap:'wrap',gap:'6px'}}>
              {SO_STATUSES.map(s=>{ const m=SO_SM[s]; const on=so.status===s; return <button key={s} onClick={()=>updateStatus(s)} style={{padding:'5px 14px',borderRadius:'20px',border:'none',cursor:'pointer',fontSize:'11px',fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',background:on?m.color:m.bg,color:on?'#fff':m.color,transition:'all .15s'}}>{m.label}</button>; })}
            </div>
          </div>
          {(so.status==='invoiced'||so.invoice_number) && (
            <div className="section-card" style={{padding:'16px 18px',marginBottom:'12px'}}>
              <div style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',marginBottom:'8px'}}>Invoice Number</div>
              <div style={{display:'flex',gap:'8px'}}>
                <input className="form-input" style={{flex:1}} placeholder="INV-2026-001" value={invoiceNum} onChange={e=>setInvoiceNum(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveInvoice()} />
                <button className="btn btn-dark btn-sm" onClick={saveInvoice} disabled={savingInv}>{savingInv?'…':'Save'}</button>
              </div>
            </div>
          )}
          {so.notes && <div className="section-card" style={{padding:'16px 18px'}}><div style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',marginBottom:'8px'}}>Notes</div><div style={{fontSize:'13.5px',color:'var(--ink)',lineHeight:1.6}}>{so.notes}</div></div>}
        </div>
      </div>
      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>Line Items</h3><span style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--muted)'}}>{items.length+' item'+(items.length!==1?'s':'')}</span></div>
        {items.length ? (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead><tr style={{borderBottom:'1px solid var(--line-2)'}}>
                {['Description','Client SKU','Qty','Unit Price','Amount'].map(h=><th key={h} style={{padding:'8px 16px',textAlign:h==='Description'||h==='Client SKU'?'left':'right',fontSize:'9.5px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {items.map((it,i)=>{ const amt=(Number(it.quantity)||0)*(Number(it.client_price)||0); return (
                  <tr key={it.id||i} style={{borderBottom:'1px solid var(--line-2)'}}>
                    <td style={{padding:'12px 16px',fontWeight:500,color:'var(--ink)'}}>{it.description||it.products?.name||'—'}
                      {it.size&&<div style={{marginTop:'4px'}}><span className="size-tag">Size {it.size}</span></div>}
                    </td>
                    <td style={{padding:'12px 16px',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--muted)'}}>{it.client_sku||'—'}</td>
                    <td style={{padding:'12px 16px',textAlign:'right',fontFamily:'var(--mono)'}}>{new Intl.NumberFormat('en-US').format(it.quantity||0)}</td>
                    {/* unitPrice, not money: this is the per-unit rate. The line
                        amount two cells along stays money() -- that is an amount
                        owed and rounds to cents. */}
                    <td style={{padding:'12px 16px',textAlign:'right',fontFamily:'var(--mono)'}}>{unitPrice(it.client_price,so.currency)}</td>
                    <td style={{padding:'12px 16px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600}}>{money(amt,so.currency)}</td>
                  </tr>
                ); })}
              </tbody>
              <tfoot><tr style={{borderTop:'2px solid var(--line-2)'}}>
                <td colSpan="4" style={{padding:'12px 16px',textAlign:'right',fontWeight:700,fontSize:'11px',textTransform:'uppercase',letterSpacing:'.08em',color:'var(--muted)'}}>Total</td>
                <td style={{padding:'12px 16px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,fontSize:'15px'}}>{money(rev,so.currency)}</td>
              </tr></tfoot>
            </table>
          </div>
        ) : <div style={{padding:'24px',textAlign:'center',color:'var(--muted)',fontSize:'13px'}}>No line items. <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>Add items →</button></div>}
      </div>
      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>Linked Factory POs</h3><button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>+ Link PO</button></div>
        {linkedPos.length ? linkedPos.map(po=>{ const poCost=(po.purchase_order_items||[]).reduce((a,i)=>a+(Number(i.quantity)||0)*(Number(i.unit_price)||0),0); return (
          <div key={po.id} style={{display:'flex',alignItems:'center',gap:'14px',padding:'14px 18px',borderBottom:'1px solid var(--line-2)',cursor:'pointer'}} onClick={()=>navigate('order-detail',{id:po.id})}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'3px'}}><span style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:'13px',color:'var(--ink)'}}>{po.client_po_number||po.order_number}</span><Badge status={po.status} /></div>
              <div style={{fontSize:'12px',color:'var(--muted)'}}>{po.companies?.name||'—'}</div>
            </div>
            <div style={{textAlign:'right'}}><div style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:'13px'}}>{money(poCost,po.currency)}</div><div style={{fontSize:'11px',color:'var(--muted)'}}>factory cost</div></div>
            <button className="btn btn-ghost btn-sm" style={{color:'var(--hot)',flexShrink:0}} onClick={e=>{e.stopPropagation();unlinkPO(po.id);}}>Unlink</button>
          </div>
        ); }) : (
          <div style={{padding:'20px 18px',fontSize:'13px',color:'var(--muted)',display:'flex',alignItems:'center',gap:'12px'}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>No factory POs linked yet — margin data won't show until one is linked. <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>Link a PO →</button></span>
          </div>
        )}
      </div>

      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>Logistics &amp; Shipment</h3>{shipment&&<Badge status={shipment.status==='in_transit'?'shipped':shipment.status==='delivered'?'delivered':'confirmed'} />}</div>
        {!shipment ? (
          <div style={{padding:'20px 18px',fontSize:'13px',color:'var(--muted)',display:'flex',alignItems:'center',gap:'12px'}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d="M1 6h13v9H1zM14 9h4l3 3v3h-7z"/><circle cx="5.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>
            <span>No shipment yet. Logistics filled on a linked PO or its shipment will appear here automatically.</span>
          </div>
        ) : (
          <div style={{padding:'4px 0'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 18px'}}>
              <span style={{flex:1}}>
                <span style={{fontSize:'14px',fontWeight:600,color:'var(--ink)'}}>{shipment.origin_port?.unlocode||shipment.origin_port?.name||'—'}</span>
                <svg width="16" height="9" viewBox="0 0 24 8" fill="none" stroke="var(--faint)" strokeWidth="1.8" style={{margin:'0 8px'}}><path d="M0 4h20M17 1l4 3-4 3"/></svg>
                <span style={{fontSize:'14px',fontWeight:600,color:'var(--ink)'}}>{shipment.destination_port?.name||shipment.destination_port?.unlocode||'—'}</span>
              </span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderTop:'1px solid var(--line-2)'}}>
              {[['Vessel',shipment.vessel_name],['Voyage #',shipment.voyage_no],['Container #',shipment.container_no],['Booking #',shipment.booking_number],['Bill of Lading',shipment.bill_of_lading],['Carrier',shipment.carrier?.name],['ETD',fmtDate(shipment.estimated_departure)],['ETA',fmtDate(shipment.estimated_arrival)]].map(([l,v],i)=>(
                <div key={l} style={{padding:'11px 18px',borderBottom:i<6?'1px solid var(--line-2)':'none',borderRight:i%2===0?'1px solid var(--line-2)':'none'}}>
                  <div style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',marginBottom:'4px'}}>{l}</div>
                  <div style={{fontSize:'13px',fontWeight:600,color:v?'var(--ink)':'var(--faint)',fontFamily:l.includes('#')||l==='Bill of Lading'?'var(--mono)':'inherit'}}>{v||'—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{marginTop:'18px'}}>
        <div className="section-head">
          <h3>Additional Costs <span style={{fontWeight:400,color:'var(--muted)',fontSize:'12px'}}>· internal only — never shown to client</span></h3>
          <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>{costs.length?'Edit Costs':'+ Add Cost'}</button>
        </div>
        {costs.length ? (
          <div style={{padding:'4px 0'}}>
            {costs.map(c=>(
              <div key={c.id} style={{display:'flex',alignItems:'center',gap:'14px',padding:'12px 18px',borderBottom:'1px solid var(--line-2)'}}>
                <span className="badge" style={{textTransform:'capitalize',background:c.kind==='freight'?'#e9eefc':c.kind==='duty'?'#fdf3e0':'#eef1f4',color:c.kind==='freight'?'#3b53c4':c.kind==='duty'?'#9a6204':'#5b6470',padding:'3px 10px',borderRadius:'100px',fontSize:'11px',fontWeight:600}}>{c.kind}</span>
                <span style={{flex:1,fontSize:'13px',color:c.note?'var(--ink)':'var(--muted)'}}>{c.note||'—'}</span>
                <span className="mono" style={{fontWeight:600,fontSize:'13px'}}>{money(c.amount,so.currency)}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',padding:'12px 18px',fontSize:'13px',fontWeight:700,background:'var(--soft)'}}>
              <span style={{color:'var(--muted)'}}>Total additional costs</span>
              <span className="mono">{money(addlCost,so.currency)}</span>
            </div>
          </div>
        ) : (
          <div style={{padding:'18px',fontSize:'13px',color:'var(--muted)'}}>
            No freight, duty, or other costs added. For DDP orders where duty/freight is already in the client price, leave this empty.
          </div>
        )}
      </div>

      <div className="card" style={{marginTop:'18px'}}>
        <div className="section-head"><h3>Cost &amp; Margin Summary <span style={{fontWeight:400,color:'var(--muted)',fontSize:'12px'}}>· internal</span></h3></div>
        <div style={{padding:'6px 0'}}>
          <div style={{display:'flex',justifyContent:'space-between',padding:'9px 18px',fontSize:'13px'}}><span style={{color:'var(--muted)'}}>Revenue (client price)</span><span className="mono" style={{fontWeight:600}}>{money(rev,so.currency)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',padding:'9px 18px',fontSize:'13px'}}><span style={{color:'var(--muted)'}}>Factory cost</span><span className="mono" style={{color:'var(--hot)'}}>{factoryCost>0?'− '+money(factoryCost,so.currency):'—'}</span></div>
          {costs.map(c=>(
            <div key={c.id} style={{display:'flex',justifyContent:'space-between',padding:'9px 18px 9px 30px',fontSize:'12.5px'}}><span style={{color:'var(--muted)',textTransform:'capitalize'}}>{c.kind}{c.note?' · '+c.note:''}</span><span className="mono" style={{color:'var(--hot)'}}>− {money(c.amount,so.currency)}</span></div>
          ))}
          <div style={{display:'flex',justifyContent:'space-between',padding:'12px 18px',fontSize:'14px',fontWeight:700,borderTop:'2px solid var(--line-2)',marginTop:'4px'}}>
            <span>Gross Margin</span>
            <span className="mono" style={{color:mc}}>{gross!==0||cost>0?money(gross,so.currency):'—'}{mgn!==null?'  ('+mgn.toFixed(1)+'%)':''}</span>
          </div>
        </div>
      </div>
    </>
  );
}
// ── Shared Quote Picker (pop-up overlay, used by Create/Edit SO & PO) ──────────
// Search the quotes catalog, pick a product + tier, returns a line item via onPick.
// priceField: 'client' for sales orders (client price), 'landed' for POs (cost).
function QuotePickerModal({ onPick, onClose, priceField='client' }){
  // Its only control is the search box, which is tagged data-noguard, so this
  // picker counts zero controls and always closes silently.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [quotes,setQuotes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [picked,setPicked]=useState(null);
  const tOf=q=>{try{return Array.isArray(q.tiers)?q.tiers:(q.tiers?JSON.parse(q.tiers):[]);}catch{return [];}};
  useEffect(()=>{ SB.from('quotes').select('*').order('product').then(({data})=>{setQuotes(data||[]);setLoading(false);}); },[]);
  const priceOf=t=>{ const v=Number(t[priceField]); if(v>0) return v; const c=Number(t.client),l=Number(t.landed); return c>0?c:(l>0?l:0); };
  const rangeOf=q=>{ const ps=tOf(q).map(priceOf).filter(Boolean); if(!ps.length) return null; const mn=Math.min(...ps),mx=Math.max(...ps); return mn===mx?money(mn):money(mn)+' – '+money(mx); };
  const filt=search?quotes.filter(q=>(q.product||'').toLowerCase().includes(search.toLowerCase())||(q.client||'').toLowerCase().includes(search.toLowerCase())||(q.factory||'').toLowerCase().includes(search.toLowerCase())||(q.sku||'').toLowerCase().includes(search.toLowerCase())):quotes;
  const choose=(q,t)=>{
    onPick({
      desc:q.product||'', sku:q.sku||'',
      qty:t.qty?String(t.qty):'',
      price:priceOf(t)?String(priceOf(t)):'',
      quoteId:q.id, client:q.client||'', factory:q.factory||'',
      // Size info for callers that support it; the PO-side handlers ignore these.
      // clientPrice is carried separately from price because priceOf() falls back to
      // landed, and per-size deltas are only meaningful against the client price.
      sizeScales:toScaleList(q.size_scale), sizeDeltas:q.size_price_deltas||[],
      clientPrice:t.client!=null?String(t.client):''
    });
    onClose();
  };
  return (
    <div className="modal-overlay" style={{zIndex:11000}} onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box" style={{maxWidth:'560px'}}>
        <div className="modal-head"><h3>{picked?'Pick a quantity tier':'Add product from catalog'}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          {!picked ? (
            <>
              <div className="qp-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input data-noguard placeholder="Search — product, client, factory, SKU…" value={search} onChange={e=>setSearch(e.target.value)} autoFocus />
              </div>
              <div className="qp-list" style={{maxHeight:'340px',overflowY:'auto'}}>
                {loading && <div className="empty" style={{padding:'30px'}}><p>Loading…</p></div>}
                {!loading && filt.length===0 && <div className="empty" style={{padding:'30px'}}><p>No products match.</p></div>}
                {!loading && filt.map(q=>{ const ts=tOf(q); const pr=rangeOf(q); return (
                  <button key={q.id} className="qp-card" onClick={()=>{ const t=tOf(q); if(t.length<=1){ choose(q,t[0]||{}); } else { setPicked(q); } }}>
                    <span className="qp-avatar" style={{background:companyColor(q.client),color:'#0b1120'}}>{initials(q.client)}</span>
                    <span className="qp-meta">
                      <div className="qp-prod">{q.product||'Untitled'}</div>
                      <div className="qp-sub">{q.client||'—'}{q.factory?' · '+q.factory:''}{q.sku?' · '+q.sku:''}</div>
                    </span>
                    <span className="qp-right">
                      <div className="qp-price" style={{color:pr?'var(--ink)':'#d97706'}}>{pr||'No price'}</div>
                      <div className="qp-tiers">{ts.length} {ts.length===1?'tier':'tiers'}</div>
                    </span>
                  </button>
                );})}
              </div>
            </>
          ) : (
            <>
              <div className="qp-banner"><span><b>{picked.product||'Quote'}</b>{' · '}{picked.client||'—'}</span><button className="x" onClick={()=>setPicked(null)}>Back</button></div>
              <div className="form-row"><label>Quantity tier</label>
                <div className="qp-tierpick">
                  {tOf(picked).map((t,i)=>(
                    <button key={i} onClick={()=>choose(picked,t)}>
                      {t.qty?Number(t.qty).toLocaleString():'—'}{' @ '}{priceOf(t)>0?money(priceOf(t)):'—'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateSOModal({onClose,onCreated}){
  // markDirty is needed here: togglePO writes linkedPOIds, which renders as a
  // styled div tick rather than a checkbox, so it never reaches a control value.
  const { ref: cardRef, guardedClose, markDirty } = useDirtyGuard(onClose);
  const nd=()=>new Date().toISOString().split('T')[0];
  const [mode,setMode]=useState('catalog');
  const [form,setForm]=useState({num:'',clientId:'',clientPO:'',date:nd(),ship:'',crd:'',cancel:'',payment:'',currency:'USD',notes:'',shipTo:'',shipMethod:''});
  const f=k=>v=>setForm(prev=>({...prev,[k]:v}));
  const [items,setItems]=useState([]);
  const si=(i,k,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[k]:v}:it));
  const addItem=()=>setItems(prev=>[...prev,{desc:'',sku:'',qty:'',price:'',quoteId:null,tierIdx:0,noPrice:false,sizeScales:[],sizeQty:{},sizePrice:{}}]);
  const rmItem=i=>setItems(prev=>prev.filter((_,idx)=>idx!==i));
  // The first time a scale is picked, seed every size at the line's current client
  // price: a flat-priced product then needs no typing and only an upcharge is edited.
  // Seeds only the sizes a NEWLY ticked scale brings in, so adding Toddler to a
  // line that already has Youth prices typed leaves those alone.
  const setSizeScales=(i,next)=>setItems(prev=>prev.map((it,idx)=>{
    if(idx!==i) return it;
    const had=new Set(sizesForSelection(it.sizeScales).map(e=>e.key));
    const seed={...(it.sizePrice||{})};
    if(it.price!==''&&it.price!=null){
      sizesForSelection(next).forEach(e=>{ if(!had.has(e.key)&&seed[e.key]==null) seed[e.key]=String(it.price); });
    }
    return {...it,sizeScales:next,sizePrice:seed};
  }));
  const setSizeQty=(i,key,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,sizeQty:{...(it.sizeQty||{}),[key]:v}}:it));
  const setSizePrice=(i,key,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,sizePrice:{...(it.sizePrice||{}),[key]:v}}:it));
  // A sized line takes its quantity from the grid; an unsized line keeps its own box.
  const lineQty=it=>sizesForSelection(it.sizeScales).length?sizesForSelection(it.sizeScales).reduce((a,e)=>a+(Number((it.sizeQty||{})[e.key])||0),0):(Number(it.qty)||0);
  // A size with no price of its own falls back to the line price -- the same rule the
  // save path uses, so the Amount column can never disagree with what gets written.
  const sizePriceOf=(it,k)=>{const v=(it.sizePrice||{})[k];return v===''||v==null?(Number(it.price)||0):(Number(v)||0);};
  const lineAmt=it=>sizesForSelection(it.sizeScales).length?sizesForSelection(it.sizeScales).reduce((a,e)=>a+(Number((it.sizeQty||{})[e.key])||0)*sizePriceOf(it,e.key),0):(Number(it.qty)||0)*(Number(it.price)||0);
  const lineUnit=it=>{const q=lineQty(it);return q>0?lineAmt(it)/q:0;};
  // Quote picker state
  const [picked,setPicked]=useState(null);
  const [tierIdx,setTierIdx]=useState(0);
  const [qSearch,setQSearch]=useState('');
  // Data
  const [clients,setClients]=useState([]);
  const [quotes,setQuotes]=useState([]);
  const [availPOs,setAvailPOs]=useState([]);
  const [linkedPOIds,setLinkedPOIds]=useState([]);
  const [poSearch,setPOSearch]=useState('');
  const [showNC,setShowNC]=useState(false);
  const [ncName,setNcName]=useState('');
  const [loading,setLoading]=useState(false);
  const tOf=q=>{try{return Array.isArray(q.tiers)?q.tiers:(q.tiers?JSON.parse(q.tiers):[]);}catch{return [];}};
  const clientPriceRange=q=>{const ps=tOf(q).map(t=>Number(t.client)||0).filter(Boolean);if(!ps.length)return null;const mn=Math.min(...ps),mx=Math.max(...ps);return mn===mx?money(mn):money(mn)+' – '+money(mx);};
  useEffect(()=>{
    (async()=>{
      const [{data:cli},{data:qs},{data:sos}] = await Promise.all([
        SB.from('companies').select('id,name,vendor_number,shipping_address').order('name'),
        SB.from('quotes').select('*').order('product'),
        SB.from('sales_orders').select('so_number').order('created_at',{ascending:false}).limit(100),
      ]);
      // Load POs separately with a fallback so a join issue can't blank the list
      let pos = null;
      const poRes = await SB.from('purchase_orders').select('id,order_number,client_po_number,status,companies!factory_company_id(name)').order('created_at',{ascending:false}).limit(300);
      pos = poRes.data;
      if (poRes.error || !pos) {
        const retry = await SB.from('purchase_orders').select('id,order_number,client_po_number,status,factory_company_id').order('created_at',{ascending:false}).limit(300);
        pos = retry.data;
      }
      setClients(cli||[]); setQuotes(qs||[]); setAvailPOs(pos||[]);
      setForm(prev=>({...prev,num:genSONum((sos||[]).map(s=>s.so_number))}));
    })();
  },[]);
  const addNC=async()=>{ const n=ncName.trim(); if(!n) return; const {data:co}=await SB.from('companies').upsert({name:n,type:'client'},{onConflict:'name,type'}).select('id,name').single(); if(co){setClients(prev=>[...prev.filter(c=>c.id!==co.id),co]);f('clientId')(co.id);} setShowNC(false);setNcName(''); };
  // size_price_deltas is [{scale,size,delta}], non-zero entries only, keyed here by
  // sizeKey so an Adult L and a Youth L stay two different upcharges. Entries
  // written before scales were recorded carry no scale and are attributed to the
  // quote's single one -- deterministic, since a legacy row has exactly one. Same
  // rule as deltasToMap in quotes.jsx; the two must not drift.
  const deltaMap=(v,scales)=>{
    let a=[]; try{ a=Array.isArray(v)?v:(v?JSON.parse(v):[]); }catch{ a=[]; }
    const list=toScaleList(scales); const m={};
    (Array.isArray(a)?a:[]).forEach(d=>{
      if(!d||d.size==null) return;
      const n=Number(d.delta); if(!isFinite(n)||n===0) return;
      const sc=d.scale!=null?String(d.scale):(list.length===1?list[0]:null);
      if(!sc) return;
      m[sc+'|'+String(d.size)]=n;
    });
    return m;
  };
  // Mirror of CreatePOModal's seedPrices, with two differences: the SO base is the
  // tier's CLIENT price (the PO base is landed/EXW), and the quote's per-size deltas
  // ride on top. What gets stored is an absolute price per size, never a delta -- the
  // save path and SizeGrid both work in absolutes, so nothing downstream needs to
  // know a delta was involved. No client price means nothing to seed from: leave the
  // boxes blank and let SizeGrid's fallbackPrice carry the arithmetic.
  const seedSizePrices=(scales,basePrice,deltas)=>{
    const base=Number(basePrice);
    if(basePrice===''||basePrice==null||!(base>0)) return {};
    const dm=deltaMap(deltas,scales);
    return sizesForSelection(scales).reduce((a,e)=>{
      const s=e.key;
      const p=base+(dm[s]||0);
      // A discount steeper than the price itself is not a price -- leave it blank
      // and fall back, the same way quotes.jsx refuses to show such a size.
      return p>0?{...a,[s]:String(p)}:a;
    },{});
  };
  const applyQuote=(q,tIdx)=>{
    setPicked(q); setTierIdx(tIdx);
    const ts=tOf(q); const tier=ts[tIdx]||ts[0]||{};
    const noPrice=!tier.client||Number(tier.client)===0;
    const scale=toScaleList(q.size_scale);
    const price=tier.client?String(tier.client):'';
    setItems([{desc:q.product||'',sku:q.sku||'',qty:tier.qty?String(tier.qty):'',price,quoteId:q.id,tierIdx:tIdx,noPrice,sizeScales:scale,sizeQty:{},sizePrice:seedSizePrices(scale,price,q.size_price_deltas)}]);
    if(q.client&&!form.clientId){const m=clients.find(c=>(c.name||'').toLowerCase()===q.client.toLowerCase());if(m)setForm(prev=>({...prev,clientId:m.id,shipTo:(m.shipping_address&&!prev.shipTo)?m.shipping_address:prev.shipTo}));}
  };
  const pickTier=i=>{
    setTierIdx(i);
    if(picked){
      const ts=tOf(picked); const tier=ts[i]||{};
      const noPrice=!tier.client||Number(tier.client)===0;
      const scale=toScaleList(picked.size_scale);
      const price=tier.client?String(tier.client):'';
      // Switching tier re-seeds prices at the new tier, but quantities the user has
      // already typed are theirs -- carry them across the wholesale item replacement.
      setItems(prev=>{
        const keptQty=(prev[0]&&(prev[0].sizeScales||[]).join(',')===scale.join(','))?(prev[0].sizeQty||{}):{};
        return [{desc:picked.product||'',sku:picked.sku||'',qty:tier.qty?String(tier.qty):'',price,quoteId:picked.id,tierIdx:i,noPrice,sizeScales:scale,sizeQty:keptQty,sizePrice:seedSizePrices(scale,price,picked.size_price_deltas)}];
      });
    }
  };
  const addExtraItem=()=>setShowPicker(true);
  const [showPicker,setShowPicker]=useState(false);
  const onPickItem=(li)=>setItems(prev=>[...prev,{desc:li.desc,sku:li.sku,qty:li.qty,price:li.price,quoteId:li.quoteId,tierIdx:0,noPrice:!li.price,sizeScales:toScaleList(li.sizeScales),sizeQty:{},sizePrice:seedSizePrices(toScaleList(li.sizeScales),li.clientPrice,li.sizeDeltas)}]);
  // markDirty: the linked-PO tick is a styled div, not a checkbox, so toggling it
  // changes no control value and the snapshot cannot see it.
  const togglePO=pid=>{ markDirty(); setLinkedPOIds(prev=>prev.includes(pid)?prev.filter(x=>x!==pid):[...prev,pid]); };
  const prevRev=items.reduce((a,it)=>a+lineAmt(it),0);
  const filtQ=qSearch?quotes.filter(q=>(q.product||'').toLowerCase().includes(qSearch.toLowerCase())||(q.client||'').toLowerCase().includes(qSearch.toLowerCase())||(q.factory||'').toLowerCase().includes(qSearch.toLowerCase())||(q.sku||'').toLowerCase().includes(qSearch.toLowerCase())):quotes;
  const filtPOs=availPOs.filter(p=>!poSearch||(p.client_po_number||'').toLowerCase().includes(poSearch.toLowerCase())||(p.order_number||'').toLowerCase().includes(poSearch.toLowerCase())||(p.companies?.name||'').toLowerCase().includes(poSearch.toLowerCase()));
  const submit=async()=>{
    if(!form.clientId){window._toast?.('Client is required','err');return;}
    if(!form.clientPO.trim()){window._toast?.('Client PO number is required','err');return;}
    if(!items.filter(it=>it.desc.trim()).length){window._toast?.('Add at least one line item','err');return;}
    // A sized line expands to one row per size, so with every size at zero it would
    // contribute nothing and the order could be saved with no line items at all.
    const noSizeQty=items.filter(it=>it.desc.trim()&&sizesForSelection(it.sizeScales).length).find(it=>lineQty(it)<=0);
    if(noSizeQty){window._toast?.('Enter a quantity for at least one size on "'+noSizeQty.desc.trim()+'"','err');return;}
    setLoading(true);
    // auto-generate so_number from client PO if not set
    const soNum = form.num.trim() || ('KUI-'+form.clientPO.trim().replace(/[^A-Za-z0-9]/g,'-').slice(0,20).toUpperCase());
    const {data:so,error:e0}=await SB.from('sales_orders').insert({so_number:soNum,client_company_id:form.clientId||null,client_po_number:form.clientPO.trim(),order_date:form.date||null,required_ship_date:form.ship||null,indc_date:form.ship||null,cargo_ready_date:form.crd||null,cancel_date:form.cancel||null,payment_terms:form.payment||null,currency:form.currency,notes:form.notes||null,delivery_address:form.shipTo||null,shipping_method:form.shipMethod||null,status:'received'}).select().single();
    if(e0||!so){alert('Error: '+(e0?.message||'unknown'));setLoading(false);return;}
    // A line with a size scale expands into one row per size carrying a quantity;
    // an unsized line still writes exactly one row, with size NULL. Sizes left blank
    // or at zero produce no row at all.
    const expand=it=>{
      const base={sales_order_id:so.id,description:it.desc.trim(),client_price:Number(it.price)||null,currency:form.currency,_quoteId:it.quoteId,_tierIdx:it.tierIdx||0};
      const sku=(it.sku||'').trim()||null;   // quote SKUs carry stray whitespace; never build "SKU -S"
      const entries=sizesForSelection(it.sizeScales);
      if(!entries.length) return [{...base,client_sku:sku,quantity:Number(it.qty)||null,size:null}];
      // THE ONE THAT ESCAPES THE QUOTE. sales_order_items.size is a bare text
      // label that prints straight onto the order confirmation as "Size L", and an
      // Adult+Youth line has two Ls -- so without qualifying here it writes two
      // rows reading identically, with identical SKUs, and the ambiguity the
      // composite key removed inside the quote reappears in front of the client.
      //
      // e.label and skuToken are computed from THIS LINE's own selection, so a
      // line that does not collide writes exactly what it always did: bare "L",
      // SKU-L, and the collar scale's S/M unscrubbed.
      return entries.map(e=>({e,q:Number((it.sizeQty||{})[e.key])||0})).filter(x=>x.q>0)
        .map(x=>({...base,client_sku:sku?sku+'-'+skuToken(x.e):null,quantity:x.q,size:x.e.label,client_price:sizePriceOf(it,x.e.key)||null}));
    };
    const toIns=items.filter(it=>it.desc.trim()).flatMap(expand);
    if(toIns.length) await SB.from('sales_order_items').insert(toIns.map(({_quoteId,_tierIdx,...rest})=>({...rest,quote_id:_quoteId||null})));
    if(linkedPOIds.length) await SB.from('sales_order_pos').insert(linkedPOIds.map(pid=>({sales_order_id:so.id,purchase_order_id:pid})));
    for(const it of toIns){
      if(it._quoteId&&Number(it.client_price)>0){
        try{const {data:q}=await SB.from('quotes').select('tiers').eq('id',it._quoteId).single();if(q){const ts=Array.isArray(q.tiers)?[...q.tiers]:(q.tiers?JSON.parse(q.tiers):[]);if(ts[it._tierIdx]&&(!Number(ts[it._tierIdx].client)||Number(ts[it._tierIdx].client)===0)){ts[it._tierIdx]={...ts[it._tierIdx],client:it.client_price};await SB.from('quotes').update({tiers:ts}).eq('id',it._quoteId);}}}catch(e){}
      }
    }
    setLoading(false); onCreated(so.id);
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      {showPicker && <QuotePickerModal priceField="client" onPick={onPickItem} onClose={()=>setShowPicker(false)} />}
      <div ref={cardRef} className="modal-box" style={{maxWidth:'680px'}}>
        <div className="modal-head"><h3>New Sales Order</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">

          <div className="qp-toggle">
            <button className={mode==='catalog'?'on':''} onClick={()=>setMode('catalog')}>Generate from Quote</button>
            <button className={mode==='manual'?'on':''} onClick={()=>{setMode('manual');setPicked(null);setItems([]);}} >Manual Entry</button>
          </div>

          {picked && (
            <div className="qp-banner">
              <span><b>{picked.product||'Quote'}</b>{' \u00b7 '}{picked.client||'—'}{picked.sku?' \u00b7 '+picked.sku:''}</span>
              <button className="x" onClick={()=>{setPicked(null);setItems([]);}}>Change</button>
            </div>
          )}

          {mode==='catalog' && !picked && (
            <>
              <div className="qp-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input data-noguard placeholder="Search quotes — product, client, factory, SKU…" value={qSearch} onChange={e=>setQSearch(e.target.value)} autoFocus />
              </div>
              <div className="qp-list">
                {filtQ.length===0&&<div className="empty" style={{padding:'40px 20px'}}><p>No quotes match.</p></div>}
                {filtQ.map(q=>{ const pr=clientPriceRange(q); const ts=tOf(q); return (
                  <button key={q.id} className="qp-card" onClick={()=>applyQuote(q,0)}>
                    <span className="qp-avatar" style={{background:companyColor(q.client),color:'#0b1120'}}>{initials(q.client)}</span>
                    <span className="qp-meta">
                      <div className="qp-prod">{q.product||'Untitled'}</div>
                      <div className="qp-sub">{q.client||'—'}{q.factory?' · '+q.factory:''}{q.sku?' · '+q.sku:''}</div>
                    </span>
                    <span className="qp-right">
                      <div className="qp-price" style={{color:pr?'var(--ink)':'#d97706'}}>{pr||'No client price'}</div>
                      <div className="qp-tiers">{ts.length} {ts.length===1?'tier':'tiers'}</div>
                    </span>
                  </button>
                );})}
              </div>
            </>
          )}

          {mode==='catalog' && picked && tOf(picked).length>0 && (
            <div className="form-row">
              <label>Pricing Tier — pick the quantity to build this SO from</label>
              <div className="qp-tierpick">
                {tOf(picked).map((t,i)=>(
                  <button key={i} className={i===tierIdx?'on':''} onClick={()=>pickTier(i)}>
                    {t.qty?Number(t.qty).toLocaleString():'—'}{' @ '}{Number(t.client)>0?money(Number(t.client)):'—'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(mode==='manual'||picked) && (<>

          <div className="form-row"><label>Client *</label>
            <select className="form-select" value={form.clientId} onChange={e=>{const cid=e.target.value;const c=clients.find(x=>x.id===cid);setForm(prev=>({...prev,clientId:cid,shipTo:(c&&c.shipping_address&&!prev.shipTo)?c.shipping_address:prev.shipTo}));}}>
              <option value="">— select client —</option>
              {clients.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c=><option key={c.id} value={c.id}>{c.name}{c.vendor_number?' ('+c.vendor_number+')':''}</option>)}
            </select>
            {!showNC?<button className="btn btn-ghost btn-sm" style={{marginTop:'8px'}} onClick={()=>setShowNC(true)}>+ New client</button>:<div style={{display:'flex',gap:'8px',marginTop:'8px',alignItems:'center'}}><input className="form-input" style={{flex:1}} placeholder="Client name…" value={ncName} onChange={e=>setNcName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNC()} autoFocus /><button className="btn btn-dark btn-sm" onClick={addNC}>Add</button><button className="btn btn-ghost btn-sm" onClick={()=>{setShowNC(false);setNcName('');}}>✕</button></div>}
          </div>

          <div className="form-row-2">
            <div><label>Client PO # *</label><input className="form-input" value={form.clientPO} onChange={e=>f('clientPO')(e.target.value)} placeholder="Client's PO number — this is the primary reference" autoFocus /></div>
            <div><label>Order Date</label><input type="date" className="form-input" value={form.date} onChange={e=>f('date')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Cargo Ready Date <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>when goods are picked up — shown to client</span></label><input type="date" className="form-input" value={form.crd} onChange={e=>f('crd')(e.target.value)} /></div>
            <div><label>INDC <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>in-DC / delivery date</span></label><input type="date" className="form-input" value={form.ship} onChange={e=>f('ship')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Cancel Date</label><input type="date" className="form-input" value={form.cancel} onChange={e=>f('cancel')(e.target.value)} /></div>
            <div></div>
          </div>
          <div className="form-row-2">
            <div><label>Internal SO # <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>auto-generated if blank</span></label><input className="form-input" style={{fontFamily:'var(--mono)'}} value={form.num} onChange={e=>f('num')(e.target.value)} placeholder="KUI-..." /></div>
            <div></div>
          </div>
          <div className="form-row-2">
            <div><label>Payment Terms</label><input className="form-input" value={form.payment} onChange={e=>f('payment')(e.target.value)} placeholder="e.g. Net 30, 50% deposit" /></div>
            <div><label>Currency</label><select className="form-select" value={form.currency} onChange={e=>f('currency')(e.target.value)}>{['USD','CAD','EUR','GBP','AUD'].map(c=><option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Shipping Method</label><select className="form-select" value={form.shipMethod} onChange={e=>f('shipMethod')(e.target.value)}>
              <option value="">— select —</option>
              <option value="FedEx">FedEx</option>
              <option value="Sine Trading">Sine Trading</option>
              <option value="Ocean Freight">Ocean Freight</option>
              <option value="Air Freight">Air Freight</option>
              <option value="Other">Other</option>
            </select></div>
            <div></div>
          </div>
          <div><label>Ship-To Address <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>prints on order confirmation</span></label><textarea className="form-input" rows={3} value={form.shipTo} onChange={e=>f('shipTo')(e.target.value)} placeholder="Full ship-to address for the client" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>

          <span className="form-section-label">Line Items</span>
          <table className="items-table">
            <thead><tr><th style={{width:'40%'}}>Product</th><th>Qty</th><th>Client Price</th><th style={{textAlign:'right'}}>Amount</th><th style={{width:'36px'}}></th></tr></thead>
            <tbody>
              {items.map((it,i)=>(
                <React.Fragment key={i}>
                  <tr>
                    <td><input value={it.desc} onChange={e=>si(i,'desc',e.target.value)} placeholder="Description…" /></td>
                    <td>{sizesForSelection(it.sizeScales).length
                      ? <div className="qty-from-sizes" title="Quantity comes from the size breakdown below"><span className="qfs-v">{lineQty(it).toLocaleString()}</span><span className="qfs-k">from sizes</span></div>
                      : <input type="number" value={it.qty} onChange={e=>si(i,'qty',e.target.value)} placeholder="0" />}</td>
                    <td>{sizesForSelection(it.sizeScales).length
                      ? <div className="qty-from-sizes" title="Blended unit price from the size breakdown below"><span className="qfs-v">{lineUnit(it).toFixed(2)}</span><span className="qfs-k">from sizes</span></div>
                      : <>
                          <input type="number" step="0.00001" value={it.price} onChange={e=>si(i,'price',e.target.value)} placeholder="0.00" style={{borderColor:it.noPrice&&!it.price?'#f59e0b':''}} />
                          {it.noPrice&&!it.price&&<div style={{fontSize:'10px',color:'#d97706',marginTop:'2px'}}>Enter client price</div>}
                          {it.noPrice&&it.price&&<div style={{fontSize:'10px',color:'#059669',marginTop:'2px'}}>Will save to catalog</div>}
                        </>}
                    </td>
                    <td className="mono" style={{textAlign:'right',whiteSpace:'nowrap',fontSize:'12.5px'}}>{money(lineAmt(it),form.currency)}</td>
                    <td><button className="rm" onClick={()=>rmItem(i)}>×</button></td>
                  </tr>
                  <tr className="item-sub-row">
                    <td colSpan={5}>
                      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',padding:'4px 0 8px'}}>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 130px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>Client SKU</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.sku||''} onChange={e=>si(i,'sku',e.target.value)} placeholder="Client SKU" /></div>
                        <div style={{flex:'1 1 280px',minWidth:0}}>
                          <SizeGrid scales={it.sizeScales||[]} onScalesChange={ks=>setSizeScales(i,ks)} quantities={it.sizeQty||{}} onQuantityChange={(k,v)=>setSizeQty(i,k,v)} prices={it.sizePrice||{}} onPriceChange={(k,v)=>setSizePrice(i,k,v)} fallbackPrice={it.price} />
                        </div>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {prevRev>0 && (
            <div className="po-draft-totals">
              <div className="pdt-grand"><span>SO Total · {form.currency}</span><span className="mono">{money(prevRev,form.currency)}</span></div>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'16px'}} onClick={addExtraItem}>+ Add Item</button>

          <span className="form-section-label">Link Factory POs (optional)</span>
          <div style={{marginBottom:'16px'}}>
            <input className="form-input" data-noguard placeholder="Search by PO # or factory name…" value={poSearch} onChange={e=>setPOSearch(e.target.value)} style={{marginBottom:'8px'}} />
            <div style={{maxHeight:'140px',overflowY:'auto',border:'1px solid var(--line-2)',borderRadius:'8px'}}>
              {filtPOs.length===0&&<div style={{padding:'16px',textAlign:'center',color:'var(--muted)',fontSize:'13px'}}>No POs found</div>}
              {filtPOs.slice(0,25).map(po=>{ const on=linkedPOIds.includes(po.id); return (
                <div key={po.id} onClick={()=>togglePO(po.id)} style={{display:'flex',alignItems:'center',gap:'10px',padding:'9px 14px',borderBottom:'1px solid var(--line-2)',cursor:'pointer',background:on?'rgba(52,97,224,.07)':'transparent'}}>
                  <div style={{width:'16px',height:'16px',borderRadius:'4px',border:'2px solid '+(on?'var(--accent)':'var(--line-2)'),background:on?'var(--accent)':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>{on&&<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>}</div>
                  <span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:'12px',color:'var(--ink)'}}>{po.client_po_number||po.order_number}</span>
                  <span style={{fontSize:'12px',color:'var(--muted)',flex:1}}>{po.companies?.name||'—'}</span>
                  <Badge status={po.status} />
                </div>
              ); })}
            </div>
            {linkedPOIds.length>0&&<div style={{fontSize:'12px',color:'var(--accent)',marginTop:'6px',fontWeight:600}}>{linkedPOIds.length+' PO'+(linkedPOIds.length!==1?'s':'')+' linked'}</div>}
          </div>
          <div className="form-row"><label>Notes</label><textarea className="form-textarea" value={form.notes} onChange={e=>f('notes')(e.target.value)} placeholder="Internal notes…" rows={3} /></div>

          </>)}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={submit} disabled={loading}>{loading?'Creating…':'Create Sales Order'}</button>
        </div>
      </div>
    </div>
  );
}

function EditSOModal({so,items:initItems,linkedPos:initLinkedPos,onClose,onSaved}){
  // markDirty for togglePO, same as CreateSOModal: the linked-PO ticks are divs.
  const { ref: cardRef, guardedClose, markDirty } = useDirtyGuard(onClose);
  const [form,setForm]=useState({num:so.so_number||'',clientId:so.client_company_id||'',clientPO:so.client_po_number||'',date:so.order_date||'',ship:so.indc_date||so.required_ship_date||'',crd:so.cargo_ready_date||'',cancel:so.cancel_date||'',payment:so.payment_terms||'',currency:so.currency||'USD',notes:so.notes||'',shipTo:so.delivery_address||'',shipMethod:so.shipping_method||''});
  const f=k=>v=>setForm(prev=>({...prev,[k]:v}));
  const [items,setItems]=useState((initItems||[]).map(it=>({id:it.id,desc:it.description||'',sku:it.client_sku||'',qty:it.quantity!=null?String(it.quantity):'',price:it.client_price!=null?String(it.client_price):''})));
  const si=(i,k,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[k]:v}:it));
  const addItem=()=>setShowPicker(true);
  const rmItem=i=>setItems(prev=>prev.filter((_,idx)=>idx!==i));
  const [costs,setCosts]=useState([]);
  useEffect(()=>{ SB.from('order_costs').select('*').eq('sales_order_id',so.id).order('created_at').then(({data})=>setCosts(data||[])); },[]);
  const addCost=async()=>{ const {data}=await SB.from('order_costs').insert({sales_order_id:so.id,kind:'freight',amount:0,currency:form.currency}).select().single(); if(data) setCosts(prev=>[...prev,data]); };
  const updCost=async(cid,patch)=>{ setCosts(prev=>prev.map(c=>c.id===cid?{...c,...patch}:c)); await SB.from('order_costs').update(patch).eq('id',cid); };
  const rmCost=async(cid)=>{ setCosts(prev=>prev.filter(c=>c.id!==cid)); await SB.from('order_costs').delete().eq('id',cid); };
  const [clients,setClients]=useState([]);
  const [showPicker,setShowPicker]=useState(false);
  const onPickItem=(li)=>setItems(prev=>[...prev,{id:null,desc:li.desc,sku:li.sku,qty:li.qty,price:li.price}]);
  const [availPOs,setAvailPOs]=useState([]);
  const [poErr,setPoErr]=useState('');
  const [linkedPOIds,setLinkedPOIds]=useState((initLinkedPos||[]).map(p=>p.id));
  const [poSearch,setPOSearch]=useState('');
  const [showNC,setShowNC]=useState(false);
  const [ncName,setNcName]=useState('');
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    (async()=>{
      const { data:cli } = await SB.from('companies').select('id,name,shipping_address').order('name');
      let pos = null;
      const poRes = await SB.from('purchase_orders').select('id,order_number,client_po_number,status,companies!factory_company_id(name)').order('created_at',{ascending:false}).limit(300);
      pos = poRes.data;
      if (poRes.error || !pos) {
        const retry = await SB.from('purchase_orders').select('id,order_number,client_po_number,status').order('created_at',{ascending:false}).limit(300);
        pos = retry.data;
        if (retry.error) setPoErr(retry.error.message);
      }
      setClients(cli||[]); setAvailPOs(pos||[]);
    })();
  },[]);
  const addNC=async()=>{ const n=ncName.trim(); if(!n) return; const {data:co}=await SB.from('companies').upsert({name:n,type:'client'},{onConflict:'name,type'}).select('id,name').single(); if(co){setClients(prev=>[...prev.filter(c=>c.id!==co.id),co]);f('clientId')(co.id);} setShowNC(false);setNcName(''); };
  // markDirty: the linked-PO tick is a styled div, not a checkbox, so toggling it
  // changes no control value and the snapshot cannot see it.
  const togglePO=pid=>{ markDirty(); setLinkedPOIds(prev=>prev.includes(pid)?prev.filter(x=>x!==pid):[...prev,pid]); };
  const save=async()=>{
    setLoading(true);
    const {error}=await SB.from('sales_orders').update({so_number:form.num.trim(),client_company_id:form.clientId||null,client_po_number:form.clientPO||null,order_date:form.date||null,required_ship_date:form.ship||null,indc_date:form.ship||null,cargo_ready_date:form.crd||null,cancel_date:form.cancel||null,payment_terms:form.payment||null,currency:form.currency,notes:form.notes||null,delivery_address:form.shipTo||null,shipping_method:form.shipMethod||null,updated_at:new Date().toISOString()}).eq('id',so.id);
    if(error){alert('Error: '+error.message);setLoading(false);return;}
    const filled=items.filter(it=>it.desc.trim());
    // SAFETY: never wipe all line items. If the form somehow has none but the
    // order already has items, skip the item sync entirely rather than delete.
    const hadItems=(initItems||[]).length>0;
    if(filled.length===0 && hadItems){
      alert('No line items to save — leaving existing items untouched to prevent data loss. Add at least one item or remove them individually.');
      setLoading(false); return;
    }
    // Non-destructive diff: update rows that have an id, insert new ones,
    // delete only the specific rows the user removed.
    const keepIds=filled.filter(it=>it.id).map(it=>it.id);
    const origIds=(initItems||[]).map(it=>it.id).filter(Boolean);
    const removed=origIds.filter(oid=>!keepIds.includes(oid));
    for(const it of filled){
      const row={description:it.desc.trim(),client_sku:it.sku||null,quantity:Number(it.qty)||null,client_price:Number(it.price)||null,currency:form.currency};
      if(it.id){ await SB.from('sales_order_items').update(row).eq('id',it.id); }
      else { await SB.from('sales_order_items').insert({...row,sales_order_id:so.id}); }
    }
    if(removed.length) await SB.from('sales_order_items').delete().in('id',removed);
    // PO links: safe to replace (junction rows only, no item data)
    const { error: delErr } = await SB.from('sales_order_pos').delete().eq('sales_order_id',so.id);
    if(delErr){ window._toast?.('Could not update PO links: '+delErr.message,'err'); setLoading(false); return; }
    if(linkedPOIds.length){
      const { error: insErr } = await SB.from('sales_order_pos').insert(linkedPOIds.map(pid=>({sales_order_id:so.id,purchase_order_id:pid})));
      if(insErr){ window._toast?.('Could not link PO: '+insErr.message,'err'); setLoading(false); return; }
    }
    window._toast?.('Saved','ok');
    setLoading(false); onSaved();
  };
  const filtPOs=availPOs.filter(p=>!poSearch||(p.client_po_number||'').toLowerCase().includes(poSearch.toLowerCase())||(p.order_number||'').toLowerCase().includes(poSearch.toLowerCase())||(p.companies?.name||'').toLowerCase().includes(poSearch.toLowerCase()));
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      {showPicker && <QuotePickerModal priceField="client" onPick={onPickItem} onClose={()=>setShowPicker(false)} />}
      <div ref={cardRef} className="modal-box" style={{maxWidth:'680px'}}>
        <div className="modal-head"><h3>{'Edit '+(so.client_po_number||so.so_number)}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>SO Number</label><input className="form-input" style={{fontFamily:'var(--mono)'}} value={form.num} onChange={e=>f('num')(e.target.value)} /></div>
            <div><label>Currency</label><select className="form-select" value={form.currency} onChange={e=>f('currency')(e.target.value)}>{['USD','CAD','EUR','GBP','AUD'].map(c=><option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div style={{marginBottom:'16px'}}><label>Client</label>
            <select className="form-select" value={form.clientId} onChange={e=>{const cid=e.target.value;const c=clients.find(x=>x.id===cid);setForm(prev=>({...prev,clientId:cid,shipTo:(c&&c.shipping_address&&!prev.shipTo)?c.shipping_address:prev.shipTo}));}}><option value="">— select client —</option>{[...clients].sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            {!showNC?<button className="btn btn-ghost btn-sm" style={{marginTop:'8px'}} onClick={()=>setShowNC(true)}>+ New client</button>:<div style={{display:'flex',gap:'8px',marginTop:'8px',alignItems:'center'}}><input className="form-input" style={{flex:1}} placeholder="Client name…" value={ncName} onChange={e=>setNcName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNC()} autoFocus /><button className="btn btn-dark btn-sm" onClick={addNC}>Add</button><button className="btn btn-ghost btn-sm" onClick={()=>{setShowNC(false);setNcName('');}}>✕</button></div>}
          </div>
          <div><label>Client PO #</label><input className="form-input" value={form.clientPO} onChange={e=>f('clientPO')(e.target.value)} /></div>
          <div className="form-row-2">
            <div><label>Order Date</label><input type="date" className="form-input" value={form.date} onChange={e=>f('date')(e.target.value)} /></div>
            <div><label>INDC <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>in-DC / delivery date</span></label><input type="date" className="form-input" value={form.ship} onChange={e=>f('ship')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Cargo Ready Date <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>when goods are picked up — shown to client</span></label><input type="date" className="form-input" value={form.crd} onChange={e=>f('crd')(e.target.value)} /></div>
            <div><label>Cancel Date</label><input type="date" className="form-input" value={form.cancel} onChange={e=>f('cancel')(e.target.value)} /></div>
          </div>
          <div><label>Payment Terms</label><input className="form-input" value={form.payment} onChange={e=>f('payment')(e.target.value)} /></div>
          <div className="form-row-2">
            <div><label>Shipping Method</label><select className="form-select" value={form.shipMethod} onChange={e=>f('shipMethod')(e.target.value)}>
              <option value="">— select —</option>
              <option value="FedEx">FedEx</option>
              <option value="Sine Trading">Sine Trading</option>
              <option value="Ocean Freight">Ocean Freight</option>
              <option value="Air Freight">Air Freight</option>
              <option value="Other">Other</option>
            </select></div>
            <div></div>
          </div>
          <div><label>Ship-To Address <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>prints on order confirmation</span></label><textarea className="form-input" rows={3} value={form.shipTo} onChange={e=>f('shipTo')(e.target.value)} placeholder="Full ship-to address for the client" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
          <span className="form-section-label">Line Items</span>
          <div style={{overflowX:'auto',marginBottom:'8px'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px',minWidth:'500px'}}>
              <thead><tr style={{borderBottom:'1px solid var(--line-2)'}}>{['Product / Description','Client SKU','Qty','Unit Price',''].map((h,i)=><th key={i} style={{padding:'6px 8px',textAlign:h===''||h==='Qty'||h==='Unit Price'?'right':'left',fontSize:'9px',textTransform:'uppercase',letterSpacing:'.08em',color:'var(--muted)',fontWeight:600}}>{h}</th>)}</tr></thead>
              <tbody>{items.map((it,i)=>(
                <tr key={i} style={{borderBottom:'1px solid var(--line-2)'}}>
                  <td style={{padding:'6px 4px'}}>
                    <input className="form-input" style={{fontSize:'12px'}} value={it.desc} onChange={e=>si(i,'desc',e.target.value)} placeholder="Description…" />
                  </td>
                  <td style={{padding:'6px 4px'}}><input className="form-input" style={{fontSize:'12px',width:'90px'}} value={it.sku} onChange={e=>si(i,'sku',e.target.value)} /></td>
                  <td style={{padding:'6px 4px'}}><input className="form-input" style={{fontSize:'12px',width:'80px',textAlign:'right'}} value={it.qty} onChange={e=>si(i,'qty',e.target.value)} /></td>
                  <td style={{padding:'6px 4px'}}><input className="form-input" style={{fontSize:'12px',width:'90px',textAlign:'right'}} value={it.price} onChange={e=>si(i,'price',e.target.value)} /></td>
                  <td style={{padding:'6px 4px',textAlign:'right'}}><button style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:'18px',lineHeight:1,padding:'0 4px'}} onClick={()=>rmItem(i)}>×</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'16px'}} onClick={addItem}>+ Add Item</button>
          <span className="form-section-label">Linked Factory POs <span style={{color:'var(--muted)',fontWeight:400}}>· {availPOs.length} in system</span></span>
          <div style={{marginBottom:'16px'}}>
            <input className="form-input" data-noguard placeholder="Search by PO # or factory…" value={poSearch} onChange={e=>setPOSearch(e.target.value)} style={{marginBottom:'8px'}} />
            {poErr && <div style={{padding:'10px 12px',marginBottom:'8px',background:'var(--hot-soft)',color:'var(--hot)',borderRadius:'8px',fontSize:'12px'}}>PO load error: {poErr}</div>}
            <div style={{maxHeight:'160px',overflowY:'auto',border:'1px solid var(--line-2)',borderRadius:'8px'}}>
              {filtPOs.length===0&&<div style={{padding:'16px',textAlign:'center',color:'var(--muted)',fontSize:'13px'}}>{availPOs.length===0?'No POs exist in the system yet':'No POs match your search'}</div>}
              {filtPOs.slice(0,25).map(po=>{ const on=linkedPOIds.includes(po.id); return (
                <div key={po.id} onClick={()=>togglePO(po.id)} style={{display:'flex',alignItems:'center',gap:'10px',padding:'9px 14px',borderBottom:'1px solid var(--line-2)',cursor:'pointer',background:on?'rgba(52,97,224,.07)':'transparent'}}>
                  <div style={{width:'16px',height:'16px',borderRadius:'4px',border:'2px solid '+(on?'var(--accent)':'var(--line-2)'),background:on?'var(--accent)':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    {on&&<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>}
                  </div>
                  <span style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:'12px',color:'var(--ink)'}}>{po.client_po_number||po.order_number}</span>
                  <span style={{fontSize:'12px',color:'var(--muted)',flex:1}}>{po.companies?.name||'—'}</span>
                  <Badge status={po.status} />
                </div>
              ); })}
            </div>
            {linkedPOIds.length>0&&<div style={{fontSize:'12px',color:'var(--accent)',marginTop:'6px',fontWeight:600}}>{linkedPOIds.length+' PO'+(linkedPOIds.length!==1?'s':'')+' linked'}</div>}
          </div>
          <span className="form-section-label">Additional Costs — internal only, never shown to client</span>
          <div style={{marginBottom:'16px'}}>
            {costs.map(c=>(
              <div key={c.id} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
                <select className="form-select" style={{width:'110px',fontSize:'12px'}} value={c.kind} onChange={e=>updCost(c.id,{kind:e.target.value})}>
                  <option value="freight">Freight</option>
                  <option value="duty">Duty</option>
                  <option value="other">Other</option>
                </select>
                <input className="form-input" style={{flex:1,fontSize:'12px'}} placeholder="Note (optional)" value={c.note||''} onChange={e=>updCost(c.id,{note:e.target.value})} />
                <input className="form-input" type="number" step="0.01" style={{width:'110px',fontSize:'12px',textAlign:'right'}} value={c.amount} onChange={e=>updCost(c.id,{amount:Number(e.target.value)||0})} />
                <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--hot)',fontSize:'18px',lineHeight:1,padding:'0 4px'}} onClick={()=>rmCost(c.id)}>×</button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addCost}>+ Add Cost</button>
            {costs.length===0 && <div style={{fontSize:'11.5px',color:'var(--muted)',marginTop:'6px'}}>For DDP orders where duty/freight is already in the client price, leave this empty.</div>}
          </div>
          <div><label>Notes</label><textarea className="form-textarea" value={form.notes} onChange={e=>f('notes')(e.target.value)} rows={3} /></div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={save} disabled={loading}>{loading?'Saving…':'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

// ── KUI Settings ──────────────────────────────────────────────────────────────
function KuiSettings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(()=>{
    SB.from('kui_settings').select('*').eq('id',1).single().then(({data})=>{
      setForm(data || { id:1, company_name:'', address:'', contact_name:'', email:'', phone:'', office_phone:'', ach_info:'' });
    });
  },[]);
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const save = async () => {
    setSaving(true);
    const { error } = await SB.from('kui_settings').upsert({ ...form, id:1, updated_at:new Date().toISOString() });
    setSaving(false);
    setMsg(error ? 'Error: '+error.message : 'Saved.'); setTimeout(()=>setMsg(''),2500);
  };
  if (!form) return <div className="loading">Loading...</div>;
  const fields = [['Company name','company_name','King Universal Inc.'],['Contact name','contact_name',''],['Email','email',''],['Phone','phone',''],['Office phone','office_phone','']];
  return (
    <>
      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>Company Info</h3><span style={{fontSize:'11px',color:'var(--muted)'}}>Used on documents sent to clients</span></div>
        <div className="logi-grid">
          {fields.map(([lab,k,ph])=>(
            <div key={k} className="logi-field"><label>{lab}</label><input className="form-input" value={form[k]||''} placeholder={ph} onChange={e=>f(k)(e.target.value)} /></div>
          ))}
          <div className="logi-field" style={{gridColumn:'1 / -1'}}><label>Address</label><textarea className="form-input" rows={2} value={form.address||''} onChange={e=>f('address')(e.target.value)} /></div>
        </div>
      </div>
      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>ACH / Wire Information</h3><span style={{fontSize:'11px',color:'var(--muted)'}}>Auto-fills the bottom of client quote sheets</span></div>
        <div style={{padding:'18px'}}>
          <label style={{display:'block',fontSize:'11px',letterSpacing:'.04em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'5px'}}>Bank / payment details</label>
          <textarea className="form-input" rows={7} value={form.ach_info||''} placeholder={"Bank name:\nBeneficiary:\nAccount #:\nRouting / ABA:\nSWIFT:\nBank address:"} onChange={e=>f('ach_info')(e.target.value)} />
          <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'8px'}}>Leave blank for now if you don't have it — the client sheet just won't show a payment block until this is filled in.</p>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'14px'}}>
        <button className="btn btn-dark" onClick={save} disabled={saving}>{saving?'Saving…':'Save settings'}</button>
        {msg && <span style={{fontSize:'13px',color:'var(--accent)'}}>{msg}</span>}
      </div>
    </>
  );
}

// ── Orders List ───────────────────────────────────────────────────────────────
function Orders({ navigate }) {
  const [rows, setRows]     = useState([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState('all');
  const [loading, setLoading] = useState(true);
  const [view, setView]     = useState('list'); // 'list' | 'board'
  const load = async () => {
    setLoading(true);
    let { data, error } = await SB.from('purchase_orders').select(PO_CARD_SELECT).order('created_at',{ascending:false});
    // Fallback: if client_po_number isn't recognized by the schema cache yet, retry without it
    if (error) {
      const fallback = 'id,order_number,status,order_date,requested_ship_date,factory:companies!factory_company_id(name),client:companies!client_company_id(name),purchase_order_items(description,products(name))';
      const retry = await SB.from('purchase_orders').select(fallback).order('created_at',{ascending:false});
      data = retry.data;
    }
    setRows(data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);
  const setStat = async (pid, st) => {
    await SB.from('purchase_orders').update({status:st,updated_at:new Date().toISOString()}).eq('id',pid);
    setRows(prev=>prev.map(p=>p.id===pid?{...p,status:st}:p));
    if (st==='shipped'){ const r=await createShipmentForPO(pid); if(r?.ok) window._toast?.('Shipment '+r.shipmentNumber+' created','ok'); else if(r?.error) window._toast?.(r.error,'err'); }
  };
  const setPct = async (pid, pct) => {
    setRows(prev=>prev.map(p=>p.id===pid?{...p,production_pct:pct}:p));
    await SB.from('purchase_orders').update({production_pct:pct,updated_at:new Date().toISOString()}).eq('id',pid);
  };
  const shown = filterPOs(rows,{search,client,status});
  return (
    <>
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'2px'}}>
        <div style={{flex:1}}><PoToolbar rows={rows} search={search} setSearch={setSearch} client={client} setClient={setClient} status={status} setStatus={setStatus} /></div>
      </div>
      <div style={{display:'inline-flex',background:'#F2F2F6',borderRadius:'10px',padding:'3px',marginBottom:'16px'}}>
        {[['list','List'],['board','Production Board']].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{padding:'7px 15px',borderRadius:'8px',border:'none',cursor:'pointer',fontSize:'12.5px',fontWeight:600,background:view===v?'#fff':'transparent',color:view===v?'#1A1A1C':'#8A8A8E',boxShadow:view===v?'0 1px 2px rgba(0,0,0,.08)':'none'}}>{l}</button>
        ))}
      </div>
      {loading ? <div className="loading">Loading...</div> :
        view==='board' ? <ProductionBoard rows={shown} navigate={navigate} onStatus={setStat} onPct={setPct} />
        : shown.length ? (
        <div className="order-card-grid">
          {shown.map(p=><OrderCard key={p.id} p={p} navigate={navigate} onStatus={setStat} />)}
        </div>
      ) : <div className="section-card"><div className="empty"><h3>No orders</h3><p>No purchase orders match your search or filters.</p></div></div>}
    </>
  );
}

// ── Production Board ──────────────────────────────────────────────────────────
const PROD_COLUMNS = [
  { key:'confirmed',      label:'Confirmed',      color:'#0071E3' },
  { key:'sampling',       label:'Sampling',       color:'#AF52DE' },
  { key:'sample_approved',label:'Sample Approved',color:'#5856D6' },
  { key:'in_production',  label:'In Production',  color:'#FF9F0A' },
  { key:'ready_to_ship',  label:'Ready to Ship',  color:'#34C759' },
];
function ProductionBoard({ rows, navigate, onStatus, onPct }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const byCol = {};
  PROD_COLUMNS.forEach(c=>{ byCol[c.key]=[]; });
  const other = [];
  rows.forEach(p=>{ if(byCol[p.status]) byCol[p.status].push(p); else other.push(p); });

  const drop = (colKey) => {
    if(dragId){ const p=rows.find(r=>r.id===dragId); if(p && p.status!==colKey) onStatus(dragId,colKey); }
    setDragId(null); setOverCol(null);
  };
  const bump = (e,p,delta) => { e.stopPropagation(); const cur=Number(p.production_pct)||0; const next=Math.max(0,Math.min(100,cur+delta)); onPct(p.id,next); };

  return (
    <div style={{overflowX:'auto',paddingBottom:'8px'}}>
      <div style={{display:'flex',gap:'12px',minWidth:'min-content'}}>
        {PROD_COLUMNS.map(col=>{
          const items=byCol[col.key];
          const on=overCol===col.key;
          return (
            <div key={col.key} onDragOver={e=>{e.preventDefault();setOverCol(col.key);}} onDragLeave={()=>setOverCol(o=>o===col.key?null:o)} onDrop={()=>drop(col.key)}
              style={{width:'270px',flexShrink:0,background:on?'#F0F4FF':'#F7F7F9',borderRadius:'14px',padding:'12px',transition:'.12s',border:'1px solid '+(on?col.color:'transparent')}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'2px 4px 12px'}}>
                <span style={{width:'8px',height:'8px',borderRadius:'50%',background:col.color}} />
                <span style={{fontSize:'12.5px',fontWeight:700,color:'#1A1A1C'}}>{col.label}</span>
                <span style={{marginLeft:'auto',fontSize:'11px',fontWeight:600,color:'#8A8A8E',background:'#fff',borderRadius:'20px',padding:'2px 8px'}}>{items.length}</span>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'9px',minHeight:'40px'}}>
                {items.map(p=>{
                  const pct=Number(p.production_pct)||0;
                  const ref=p.client_po_number||p.order_number||'—';
                  const client=p.client?.name||'—';
                  return (
                    <div key={p.id} draggable onDragStart={()=>setDragId(p.id)} onDragEnd={()=>{setDragId(null);setOverCol(null);}} onClick={()=>navigate('order-detail',{id:p.id})}
                      style={{background:'#fff',borderRadius:'11px',padding:'12px 13px',cursor:'grab',boxShadow:'0 1px 2px rgba(0,0,0,.05),0 1px 3px rgba(0,0,0,.04)',border:'1px solid #EFEFF1',opacity:dragId===p.id?.5:1}}>
                      <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ref}</div>
                      <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'2px',marginBottom:'10px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{client}</div>
                      {/* % complete */}
                      <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
                        <div style={{flex:1,height:'6px',background:'#F0F0F2',borderRadius:'3px',overflow:'hidden'}}>
                          <div style={{height:'100%',width:pct+'%',background:col.color,borderRadius:'3px',transition:'width .3s'}} />
                        </div>
                        <span style={{fontSize:'11px',fontWeight:700,color:'#4A4A4E',fontVariantNumeric:'tabular-nums',minWidth:'30px',textAlign:'right'}}>{pct}%</span>
                      </div>
                      <div style={{display:'flex',gap:'4px',marginTop:'8px'}}>
                        <button onClick={e=>bump(e,p,-10)} style={{flex:1,border:'1px solid #EAEAEE',background:'#FAFAFB',borderRadius:'7px',padding:'4px 0',fontSize:'12px',fontWeight:600,color:'#8A8A8E',cursor:'pointer'}}>−10</button>
                        <button onClick={e=>bump(e,p,10)} style={{flex:1,border:'1px solid #EAEAEE',background:'#FAFAFB',borderRadius:'7px',padding:'4px 0',fontSize:'12px',fontWeight:600,color:'#1A1A1C',cursor:'pointer'}}>+10</button>
                      </div>
                    </div>
                  );
                })}
                {items.length===0 && <div style={{fontSize:'11.5px',color:'#C0C0C4',textAlign:'center',padding:'14px 0'}}>Drop here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Order Detail ──────────────────────────────────────────────────────────────
function OrderDetail({ id, navigate }) {
  const [po, setPO]       = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [ship, setShip]   = useState(null);
  const [logi, setLogi]   = useState({});
  const [savingLogi, setSavingLogi] = useState(false);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [noteMsg, setNoteMsg]   = useState('');
  const [posting, setPosting]   = useState(false);
  const [noteAssignee, setNoteAssignee] = useState('all');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const load = async () => {
    const [{ data: p },{ data: its }] = await Promise.all([
      SB.from('purchase_orders').select('*,companies!factory_company_id(name,email),client:companies!client_company_id(name,vendor_number,po_notes)').eq('id',id).single(),
      SB.from('purchase_order_items').select('*,products(sku,name)').eq('purchase_order_id',id)
    ]);
    // If the PO has no direct client (linked only via SO), resolve client + po_notes through the linked sales order
    if (p && (!p.client || (!p.client.po_notes && !p.client.name))) {
      const { data: soLink } = await SB.from('sales_order_pos')
        .select('sales_orders(client_company_id, client:companies!client_company_id(name,vendor_number,po_notes))')
        .eq('purchase_order_id', id).limit(1).maybeSingle();
      const soClient = soLink?.sales_orders?.client;
      if (soClient) p.client = { ...(p.client||{}), name: p.client?.name || soClient.name, vendor_number: p.client?.vendor_number || soClient.vendor_number, po_notes: p.client?.po_notes || soClient.po_notes };
    }
    setPO(p); setItems(its||[]);
    // linked shipment (first one), if any
    const { data: links } = await SB.from('shipment_pos').select('shipment_id').eq('purchase_order_id',id).limit(1);
    let sh = null;
    if (links && links.length) {
      const { data: s } = await SB.from('shipments').select('*').eq('id',links[0].shipment_id).single();
      sh = s;
    }
    setShip(sh);
    setLogi({
      vessel_name: sh?.vessel_name||'', container_no: sh?.container_no||'', booking_number: sh?.booking_number||'',
      bill_of_lading: sh?.bill_of_lading||'', voyage_no: sh?.voyage_no||'',
      etd: sh?.estimated_departure ? sh.estimated_departure.slice(0,10) : '',
      eta: sh?.estimated_arrival ? sh.estimated_arrival.slice(0,10) : '',
    });
    // order notes
    const { data: ns } = await SB.from('order_notes').select('*').eq('purchase_order_id',id).order('created_at',{ascending:false});
    setNotes(ns||[]);
    // attachments from storage (bucket 'po-attachments')
    try {
      const { data: files } = await SB.storage.from('po-attachments').list(id+'/');
      setAttachments(files?.filter(f=>f.name)|| []);
    } catch(e){ setAttachments([]); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[id]);
  const updateStatus = async (status) => {
    await SB.from('purchase_orders').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    setPO(prev=>({...prev,status}));
    if (status === 'shipped') {
      const r = await createShipmentForPO(id);
      if (r?.ok) window._toast?.('Shipment '+r.shipmentNumber+' created automatically','ok');
      else if (r?.error) window._toast?.(r.error,'err');
    }
  };
  const generateShipment = async () => {
    const r = await createShipmentForPO(id);
    if (r?.ok) {
      await updateStatus('shipped');
      window._toast?.('Shipment '+r.shipmentNumber+' created · PO & SO set to Shipped','ok');
      load();
    } else if (r === false) {
      window._toast?.('This PO already has a linked shipment','info');
    } else {
      window._toast?.(r?.error||'Shipment creation failed','err');
    }
  };
  // Turn this PO into a shipment (once). Returns true if a new shipment was made.
  const ensureShipmentForPO = async () => {
    try {
      const { data: links } = await SB.from('shipment_pos').select('shipment_id').eq('purchase_order_id',id).limit(1);
      if (links && links.length) return false; // already linked
      const base = (po?.order_number || id.slice(0,8)).toString().replace(/^PO[-\s]?/i,'');
      const num  = 'SHP-'+base+'-'+Date.now().toString(36).slice(-4).toUpperCase();
      const { data: ship, error: sErr } = await SB.from('shipments').insert({
        shipment_number: num,
        status: 'in_transit',
        client_company_id: po?.client_company_id || null,
      }).select('id').single();
      if (sErr || !ship) { window._toast?.('Shipment creation failed: '+(sErr?.message||'unknown'),'err'); return false; }
      await SB.from('shipment_pos').insert({ shipment_id: ship.id, purchase_order_id: id });
      return true;
    } catch(e){ window._toast?.('Shipment creation error: '+e.message,'err'); return false; }
  };
  // Find this PO's shipment, creating+linking one if it doesn't exist yet.
  const getOrCreateShipmentId = async () => {
    if (ship?.id) return ship.id;
    const { data: links } = await SB.from('shipment_pos').select('shipment_id').eq('purchase_order_id',id).limit(1);
    if (links && links.length) return links[0].shipment_id;
    const base = (po?.order_number || id.slice(0,8)).toString().replace(/^PO[-\s]?/i,'');
    const num  = 'SHP-'+base+'-'+Date.now().toString(36).slice(-4).toUpperCase();
    const { data: s } = await SB.from('shipments').insert({ shipment_number:num, status:'created', client_company_id: po?.client_company_id||null }).select().single();
    if (!s) return null;
    await SB.from('shipment_pos').insert({ shipment_id:s.id, purchase_order_id:id });
    setShip(s);
    return s.id;
  };
  const setLg = k => v => setLogi(prev=>({...prev,[k]:v}));
  const saveLogistics = async () => {
    setSavingLogi(true);
    const sid = await getOrCreateShipmentId();
    if (!sid){ setSavingLogi(false); alert('Could not save logistics.'); return; }
    const upd = {
      vessel_name: logi.vessel_name||null, container_no: logi.container_no||null, voyage_no: logi.voyage_no||null,
      booking_number: logi.booking_number||null, bill_of_lading: logi.bill_of_lading||null,
      estimated_departure: logi.etd ? new Date(logi.etd+'T12:00:00').toISOString() : null,
      estimated_arrival:   logi.eta ? new Date(logi.eta+'T12:00:00').toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { data: s, error } = await SB.from('shipments').update(upd).eq('id',sid).select().single();
    setSavingLogi(false);
    if (error){ alert('Error saving logistics: '+error.message); return; }
    setShip(s);
    setNoteMsg('Logistics saved.'); setTimeout(()=>setNoteMsg(''),2500);
  };
  const postNote = async () => {
    const body = (noteText||'').trim(); if(!body) return;
    setPosting(true);
    let author=null; try{ const { data } = await SB.auth.getUser(); author=data?.user?.email||null; }catch(e){}
    const assignedTo = noteAssignee==='all' ? null : noteAssignee;
    const { data:n, error } = await SB.from('order_notes').insert({ purchase_order_id:id, body, author_email:author, assigned_to:assignedTo }).select().single();
    if (error){ setPosting(false); alert('Couldn\u2019t post note: '+error.message); return; }
    setNotes(prev=>[n,...prev]); setNoteText('');
    try {
      const whoName = author ? author.split('@')[0] : 'Someone';
      const assigneeName = noteAssignee==='all' ? 'team' : (TEAM.find(m=>m.email===noteAssignee)?.name||noteAssignee.split('@')[0]);
      const recipients = noteAssignee==='all'
        ? TEAM.map(t=>t.email).filter(e=>e!==author)
        : [noteAssignee].filter(e=>e!==author);
      const esc = s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const taskPrefix = noteAssignee!=='all' ? '<strong style="color:#3461e0">@'+esc(assigneeName)+'</strong> \u2014 task from ' : 'Note on order ';
      const clientSuffix = po?.companies?.name ? ' &middot; '+esc(po.companies.name) : '';
      const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:8px">'
        +'<p style="font-size:13px;color:#64748b;margin:0 0 4px">'+taskPrefix+'<strong style="color:#0b1120">'+esc(po?.order_number||'')+'</strong>'+clientSuffix+'</p>'
        +'<div style="background:#f6f8fb;border:1px solid #e6eaf0;border-radius:10px;padding:16px 18px;margin:10px 0 16px">'
        +'<p style="margin:0;font-size:15px;color:#0b1120;line-height:1.55">'+esc(body)+'</p></div>'
        +'<p style="font-size:12px;color:#94a3b8;margin:0 0 16px">Posted by '+esc(whoName)+'</p>'
        +'<a href="https://orders.vessl.io" style="display:inline-block;background:#0b1530;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open in Vessl &rarr;</a>'
        +'</div>';
      if (recipients.length){
        const subj = (noteAssignee!=='all'?'Task for you':'Order note')+' \u00b7 '+(po?.order_number||'');
        const { error:mailErr } = await SB.functions.invoke('send-email',{ body:{ to:recipients, replyTo:author||undefined, subject:subj, html } });
        setNoteMsg(mailErr ? 'Note posted (email skipped).' : 'Note posted & '+assigneeName+' notified.');
      } else setNoteMsg('Note posted.');
    } catch(e){ setNoteMsg('Note posted (email skipped).'); }
    setNoteAssignee('all');
    setTimeout(()=>setNoteMsg(''),3000);
    setPosting(false);
  };
  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const path = id+'/'+Date.now()+'-'+safeName;
    const { error } = await SB.storage.from('po-attachments').upload(path, file, { upsert:false });
    if (error){ setUploading(false); alert('Upload failed: '+error.message+'\n\nMake sure the "po-attachments" storage bucket has been created in Supabase.'); return; }
    const { data: files } = await SB.storage.from('po-attachments').list(id+'/');
    setAttachments(files?.filter(f=>f.name)||[]);
    setUploading(false);
  };
  const deleteAttachment = async (name) => {
    setConfirmDel({title:'Remove attachment?',message:'This file will be permanently deleted.',onConfirm:()=>{ setConfirmDel(null); deleteAttachmentConfirmed(name); }});
  };
  const attachUrl = (name) => SB.storage.from('po-attachments').getPublicUrl(id+'/'+name).data.publicUrl;
  const [confirmDel, setConfirmDel] = useState(null); // {title,message,onConfirm}
  const deletePO = async () => {
    await SB.from('purchase_order_items').delete().eq('purchase_order_id',id);
    await SB.from('order_notes').delete().eq('purchase_order_id',id);
    await SB.from('shipment_pos').delete().eq('purchase_order_id',id);
    const { error } = await SB.from('purchase_orders').delete().eq('id',id);
    if (error){ alert('Error: '+error.message); return; }
    navigate('orders');
  };
  const deleteAttachmentConfirmed = async (name) => {
    await SB.storage.from('po-attachments').remove([id+'/'+name]);
    setAttachments(prev=>prev.filter(f=>f.name!==name));
  };
  const genPO = async () => {
    const win = window.open('', '_blank');
    if (win) win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating PO…</body>');
    // Gather attachments — embed images, list PDFs/other files separately
    const imgExts = ['png','jpg','jpeg','gif','webp','bmp'];
    const artImages = []; const otherFiles = [];
    for (const f of (attachments||[])) {
      const ext = (f.name.split('.').pop()||'').toLowerCase();
      if (imgExts.includes(ext)) artImages.push({ name: f.name, url: attachUrl(f.name) });
      else otherFiles.push(f.name);
    }
    // Build doc data directly from already-loaded state — no RPC needed
    const docData = {
      po_number: po.order_number || po.client_po_number || id.slice(0,8).toUpperCase(),
      currency: po.currency || 'USD',
      supplier: { name: po.companies?.name || '—', email: po.companies?.email || '', lines: [] },
      ship_to: { name: 'King Universal Inc.' },
      totals: {
        subtotal, mold_fee: mold, grand,
        deposit_pct: po.deposit_percent || 0, deposit_amt: dep || 0,
      },
      lines: items.map(it => ({
        description: it.description || it.products?.name || '—',
        sku: it.products?.sku || '',
        size: it.size || '',
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
        line_amount: (Number(it.quantity)||0) * (Number(it.unit_price)||0),
        ci_value: it.ci_value,
        carton_info: it.carton_info || '',
        vpn: it.vpn || '',
        master_sku: it.master_sku || '',
        pack_sku: it.pack_sku || '',
        baby_sku: it.baby_sku || '',
        retail_price: it.retail_price,
      })),
      order_date: po.order_date,
      required_ship_date: po.requested_ship_date || po.required_ship_date,
      payment_terms: po.payment_terms || '—',
      incoterm: po.incoterm || '—',
      client_po: po.client_po_number || '',
      notes: po.notes || '',
    };
    const html = buildPODoc(docData, {
      pallet: po.pallet_info, clientName: po.client?.name,
      testingRequired: po.testing_required,
      deliveryAddress: po.delivery_address, shippingMethod: po.shipping_method,
      clientNotes: po.client?.po_notes || '',
      cancelDate: po.cancel_date,
      needsSamples: po.needs_samples, sampleType: po.sample_type, sampleQty: po.sample_qty, sampleDate: po.sample_date,
      artImages, otherFiles,
    });
    if (win) { win.document.open(); win.document.write(html); win.document.close(); setTimeout(()=>{ try{ win.focus(); win.print(); }catch(e){} }, 600); }
    else {
      const url = URL.createObjectURL(new Blob([html],{type:'text/html'}));
      const a = document.createElement('a'); a.href=url; a.download='PO-'+(po.order_number||id)+'.html';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url), 4000);
    }
  };
  if (loading) return <div className="loading">Loading...</div>;
  if (!po) return <div className="empty"><h3>Order not found</h3></div>;
  const subtotal = items.reduce((a,i)=>a+(Number(i.quantity)*Number(i.unit_price)),0);
  const mold = Number(po.mold_fee||0);
  const grand = subtotal+mold;
  const dep = po.deposit_percent ? grand*(po.deposit_percent/100) : null;
  const notifyLabel = posting ? 'Posting...' : noteAssignee==='all' ? 'Post & notify team' : 'Post & notify '+((TEAM.find(m=>m.email===noteAssignee)||{}).name||'person');
  const onFileChange = (e) => { const f = e.target.files && e.target.files[0]; if (f) uploadFile(f); e.target.value = ''; };
  return (
    <>
      <div style={{display:'flex',gap:'10px',marginBottom:'20px',flexWrap:'wrap'}}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate('orders')}>← Back</button>
        <button className="btn btn-dark btn-sm" onClick={genPO}>Generate PO PDF</button>
        {po.status !== 'shipped' && po.status !== 'delivered' && po.status !== 'closed' && (
          <button className="btn btn-accent btn-sm" onClick={generateShipment}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6h13v9H1zM14 9h4l3 3v3h-7z"/><circle cx="5.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>
            Generate Shipment
          </button>
        )}
        <div style={{flex:1}} />
        <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>Edit</button>
        <button className="btn btn-ghost btn-sm" style={{color:'var(--hot)'}} onClick={()=>setConfirmDel({title:'Delete purchase order?',message:'This will permanently delete '+( po?.order_number||'this PO')+' and all its line items.',onConfirm:()=>{setConfirmDel(null);deletePO();}})}>Delete</button>
      </div>
      {confirmDel && <ConfirmModal title={confirmDel.title} message={confirmDel.message} onConfirm={confirmDel.onConfirm} onCancel={()=>setConfirmDel(null)} />}
      {editing && <PoEditModal po={po} items={items} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);load();}} />}
      <div style={{marginBottom:'22px'}}>
        <div style={{fontSize:'10px',fontWeight:700,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'6px'}}>Purchase Order</div>
        <div style={{display:'flex',alignItems:'center',gap:'14px',flexWrap:'wrap'}}>
          <h1 style={{fontFamily:'var(--mono)',fontSize:'30px',fontWeight:700,color:'var(--ink)',letterSpacing:'-.01em',lineHeight:1}}>{po.client_po_number||po.order_number||'—'}</h1>
          <Badge status={po.status} />
        </div>
        {po.client?.name && <div style={{fontSize:'14px',color:'var(--muted)',marginTop:'6px'}}>{po.client.name}{po.companies?.name?' · '+po.companies.name:''}</div>}
      </div>
      <div className="detail-grid">
        <div className="detail-block">
          <div className="blabel">Factory</div>
          <div className="bval">{po.companies?.name||'—'}</div>
          <div className="bsub">{po.companies?.email||''}</div>
          {po.client?.name && <div style={{marginTop:'10px',paddingTop:'10px',borderTop:'1px solid var(--line)'}}><div style={{color:'var(--muted)',fontSize:'11px',marginBottom:'2px'}}>CLIENT</div><div style={{fontSize:'13px',fontWeight:500}}>{po.client.name}</div>{po.client.vendor_number && <div style={{fontSize:'11.5px',color:'var(--muted)'}}>Vendor # {po.client.vendor_number} · internal</div>}</div>}
          {po.pallet_info && <div style={{marginTop:'10px',fontSize:'12px',color:'var(--muted)'}}><span style={{textTransform:'uppercase',fontSize:'10px'}}>Pallet</span> · {po.pallet_info}</div>}
          {po.needs_samples && <div style={{marginTop:'10px',padding:'8px 10px',background:'#fef9c3',borderRadius:'8px',fontSize:'12px',color:'#854d0e'}}><b>Samples required:</b> {po.sample_type||'Required'}{po.sample_qty?' · '+po.sample_qty+' pcs':''}{po.sample_date?' · due '+fmtDate(po.sample_date):''}</div>}
        </div>
        <div className="detail-block">
          <div className="blabel">Order Details</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',fontSize:'13px'}}>
            {[['ORDER DATE',fmtDate(po.order_date)],['CRD',fmtDate(po.cargo_ready_date||po.requested_ship_date)],['CANCEL DATE',po.cancel_date?fmtDate(po.cancel_date):'—'],['INCOTERM',po.incoterm||'—'],['PAYMENT',po.payment_terms||'—']].map(([l,v])=>(
              <div key={l}><div style={{color:'var(--muted)',fontSize:'11px',marginBottom:'3px'}}>{l}</div>{v}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="detail-block" style={{marginBottom:'20px'}}>
        <div className="blabel">Status &mdash; tap to change</div>
        <div className="status-pills">
          {STATUSES.map(s=>(
            <button key={s} className={'status-pill '+(po.status===s?'on':'')+' sp-'+s} onClick={()=>updateStatus(s)}>{s.replace(/_/g,' ')}</button>
          ))}
        </div>
        {po.notes && <div style={{marginTop:'12px',fontSize:'12.5px',color:'var(--muted)',paddingTop:'12px',borderTop:'1px solid var(--line)'}}>{po.notes}</div>}
      </div>

      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>Logistics</h3></div>
        <div className="logi-grid">
          {[['Vessel / Boat','vessel_name','e.g. MAERSK SELETAR'],['Container #','container_no','e.g. MSKU1234567'],['Voyage #','voyage_no','e.g. 084W'],['Booking #','booking_number',''],['Bill of Lading','bill_of_lading','']].map(([lab,k,ph])=>(
            <div key={k} className="logi-field"><label>{lab}</label><input className="form-input" value={logi[k]||''} placeholder={ph} onChange={e=>setLg(k)(e.target.value)} /></div>
          ))}
          <div className="logi-field"><label>ETD</label><input type="date" className="form-input" value={logi.etd||''} onChange={e=>setLg('etd')(e.target.value)} /></div>
          <div className="logi-field"><label>ETA</label><input type="date" className="form-input" value={logi.eta||''} onChange={e=>setLg('eta')(e.target.value)} /></div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'0 18px 16px'}}>
          <button className="btn btn-dark btn-sm" onClick={saveLogistics} disabled={savingLogi}>{savingLogi?'Saving…':'Save logistics'}</button>
          {!ship && <span style={{fontSize:'12px',color:'var(--muted)'}}>Saving will create a shipment for this PO.</span>}
        </div>
      </div>
      <div className="section-card">
        <div className="section-head"><h3>Line Items</h3></div>
        {items.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product / Description</th>
                <th>SKU Info</th>
                <th className="num">Qty</th>
                <th className="num">CI Value</th>
                <th className="num">Unit Cost</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it=>{
                const skuParts=[it.master_sku&&('Master: '+it.master_sku),it.pack_sku&&('Pack: '+it.pack_sku),it.baby_sku&&('Baby: '+it.baby_sku)].filter(Boolean);
                return (
                  <tr key={it.id}>
                    <td>
                      <div style={{fontWeight:500}}>{it.description||it.products?.name||'—'}</div>
                      {it.size&&<div style={{marginTop:'3px'}}><span className="size-tag">Size {it.size}</span></div>}
                      {it.products?.sku&&<div className="mono" style={{fontSize:'11px',color:'var(--muted)'}}>SKU: {it.products.sku}</div>}
                      {it.vpn&&<div className="mono" style={{fontSize:'11px',color:'var(--muted)'}}>VPN# {it.vpn}</div>}
                      {it.carton_info&&<div style={{fontSize:'11px',color:'var(--muted)',marginTop:'2px'}}>{it.carton_info}</div>}
                    </td>
                    <td style={{verticalAlign:'top'}}>
                      {skuParts.length>0 ? skuParts.map((s,i)=><div key={i} className="mono" style={{fontSize:'11px',color:'var(--muted)'}}>{s}</div>) : <span style={{color:'var(--faint)'}}>—</span>}
                      {it.retail_price!=null&&<div style={{fontSize:'11px',color:'var(--ok)',marginTop:'2px',fontWeight:600}}>Retail: {money(it.retail_price,po.currency)}</div>}
                    </td>
                    <td className="mono num">{fmtNum(it.quantity)}</td>
                    <td className="mono num">{it.ci_value!=null?money(it.ci_value,po.currency):'—'}</td>
                    <td className="mono num">{unitPrice(it.unit_price,po.currency)}</td>
                    <td className="mono num" style={{fontWeight:600}}>{money((Number(it.quantity)||0)*(Number(it.unit_price)||0),po.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No items</h3></div>}
        <div className="totals-block">
          <div className="total-row"><span className="k">Goods subtotal</span><span className="v">{money(subtotal,po.currency)}</span></div>
          {mold>0 && <div className="total-row"><span className="k">Tooling / mold</span><span className="v">{money(mold,po.currency)}</span></div>}
          {po.sample_fee>0 && <div className="total-row" style={{opacity:.6,fontStyle:'italic'}}><span className="k">Sample fee (sep.)</span><span className="v">{money(po.sample_fee,po.currency)}</span></div>}
          <div className="total-grand"><span>Total {po.currency||'USD'}</span><span className="mono">{money(grand,po.currency)}</span></div>
          {dep && <div className="total-row" style={{marginTop:'4px'}}><span className="k">{po.deposit_percent}% deposit</span><span className="v">{money(dep,po.currency)}</span></div>}
        </div>
      </div>

      <OrderNotes
        notes={notes} noteText={noteText} setNoteText={setNoteText}
        noteAssignee={noteAssignee} setNoteAssignee={setNoteAssignee}
        postNote={postNote} posting={posting} noteMsg={noteMsg}
      />
      <OrderAttachments
        attachments={attachments} uploading={uploading}
        onFileChange={onFileChange} attachUrl={attachUrl}
        deleteAttachment={deleteAttachment}
      />
    </>
  );
}

function OrderNotes({ notes, noteText, setNoteText, noteAssignee, setNoteAssignee, postNote, posting, noteMsg }) {
  const btnLabel = posting ? 'Posting...' : noteAssignee === 'all' ? 'Post & notify team' : 'Post & notify ' + ((TEAM.find(m => m.email === noteAssignee) || {}).name || 'person');
  return (
    <div className="section-card" style={{marginTop:'20px'}}>
      <div className="section-head"><h3>Notes &amp; Activity</h3></div>
      <div className="note-composer">
        <div style={{marginBottom:'10px'}}>
          <div style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)',marginBottom:'6px'}}>Notify</div>
          <div className="filters" style={{flexWrap:'wrap',gap:'6px'}}>
            <button className={'filter-btn' + (noteAssignee === 'all' ? ' active' : '')} onClick={() => setNoteAssignee('all')}>All</button>
            {TEAM.map(m => (
              <button key={m.email} className={'filter-btn' + (noteAssignee === m.email ? ' active' : '')} onClick={() => setNoteAssignee(m.email)}>{m.name}</button>
            ))}
          </div>
        </div>
        <textarea className="form-input" rows={3} placeholder="Add a note or task..." value={noteText} onChange={e => setNoteText(e.target.value)} />
        <div style={{display:'flex',alignItems:'center',gap:'12px',marginTop:'10px'}}>
          <button className="btn btn-dark btn-sm" onClick={postNote} disabled={posting || !noteText.trim()}>{btnLabel}</button>
          {noteMsg && <span style={{fontSize:'12.5px',color:'var(--accent)'}}>{noteMsg}</span>}
        </div>
      </div>
      <div className="note-list">
        {notes.length > 0 ? notes.map(n => {
          const assigneeName = n.assigned_to && n.assigned_to !== 'all' ? ((TEAM.find(m => m.email === n.assigned_to) || {}).name || n.assigned_to.split('@')[0]) : null;
          return (
            <div key={n.id} className="note-item">
              <div className="note-avatar" style={{background:companyColor(n.author_email || '?')}}>{initials(n.author_email || '?')}</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="note-body">{n.body}</div>
                <div className="note-meta">
                  {(n.author_email || 'unknown').split('@')[0]}
                  {assigneeName && <span style={{color:'var(--accent)'}}> {'\u2192'} {assigneeName}</span>}
                  {' \u00b7 '}{fmtDateTime(n.created_at)}
                </div>
              </div>
            </div>
          );
        }) : <div style={{padding:'8px 18px 18px',fontSize:'13px',color:'var(--muted)'}}>No notes yet.</div>}
      </div>
    </div>
  );
}

function OrderAttachments({ attachments, uploading, onFileChange, attachUrl, deleteAttachment }) {
  const borderVal = attachments.length > 0 ? '1px solid var(--line)' : 'none';
  const spanClass = 'btn btn-ghost btn-sm' + (uploading ? ' disabled' : '');
  return (
    <div className="section-card" style={{marginTop:'20px'}}>
      <div className="section-head">
        <h3>Attachments</h3>
        <span style={{fontSize:'11px',color:'var(--muted)'}}>Photos, spec sheets, samples</span>
      </div>
      <div style={{padding:'14px 18px',borderBottom:borderVal}}>
        <label style={{cursor: uploading ? 'default' : 'pointer'}}>
          <span className={spanClass}>{uploading ? 'Uploading...' : '+ Add attachment'}</span>
          <input type="file" accept="image/*,.pdf" style={{display:'none'}} disabled={uploading} onChange={onFileChange} />
        </label>
        <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'6px',marginBottom:0}}>JPEG, PNG, PDF</p>
      </div>
      {attachments.length > 0 && (
        <div>
          {attachments.map(f => {
            const parts = f.name.split('-');
            const displayName = parts.length > 1 ? parts.slice(1).join('-') : f.name;
            const href = attachUrl(f.name);
            return (
              <div key={f.name} style={{display:'flex',alignItems:'center',gap:'12px',padding:'11px 18px',borderBottom:'1px solid var(--line-2)'}}>
                <span style={{flex:1,fontSize:'13px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displayName}</span>
                <a href={href} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">View</a>
                <button className="btn btn-ghost btn-sm" style={{color:'var(--hot)'}} onClick={() => deleteAttachment(f.name)}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PO Edit Modal ───────────────────────────────────────────────────────────
function PoEditModal({ po, items:initialItems, onClose, onSaved }) {
  // markDirty for the sample-type chips: form.sample_type is a comma-joined
  // string rendered only as button highlighting, never as a control's value.
  const { ref: cardRef, guardedClose, markDirty } = useDirtyGuard(onClose);
  const [form, setForm] = useState({
    num:po.order_number||'', date:po.order_date||'', ship:po.cargo_ready_date||po.requested_ship_date||'', cancel:po.cancel_date||'',
    inco:po.incoterm||'', pay:po.payment_terms||'', dep:po.deposit_percent!=null?String(po.deposit_percent):'',
    mold:po.mold_fee!=null?String(po.mold_fee):'', sample:po.sample_fee!=null?String(po.sample_fee):'',
    currency:po.currency||'USD', notes:po.notes||'', status:po.status||'draft', pallet:po.pallet_info||'',
    needs_samples:!!po.needs_samples, sample_type:po.sample_type||'', sample_qty:po.sample_qty!=null?String(po.sample_qty):'', sample_date:po.sample_date||'',
    clientId: po.client_company_id||'',
    testing_required: !!po.testing_required, delivery_address: po.delivery_address||'', shipping_method: po.shipping_method||''
  });
  const [items, setItems] = useState((initialItems||[]).map(it=>({id:it.id,prodId:it.product_id||'',desc:it.description||it.products?.name||'',qty:it.quantity!=null?String(it.quantity):'',price:it.unit_price!=null?String(it.unit_price):'',ci:it.ci_value!=null?String(it.ci_value):'',carton:it.carton_info||'',vpn:it.vpn||'',masterSku:it.master_sku||'',packSku:it.pack_sku||'',babySku:it.baby_sku||'',retailPrice:it.retail_price!=null?String(it.retail_price):''})));
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const setItem=(i,k,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[k]:v}:it));
  const addItem=()=>setShowPicker(true);
  const [showPicker,setShowPicker]=useState(false);
  const onPickPOItem=(li)=>setItems(prev=>[...prev,{id:null,prodId:'',desc:li.desc,qty:li.qty,price:li.price,ci:'',carton:'',vpn:'',masterSku:'',packSku:'',babySku:'',retailPrice:''}]);
  const rmItem =i=>setItems(prev=>prev.filter((_,idx)=>idx!==i));
  const [products, setProducts] = useState([]);
  const [recentDescs, setRecentDescs] = useState([]);
  const [clients, setClients] = useState([]);
  const [eSrchIdx, setESrchIdx] = useState(-1);
  const [eSrchHits, setESrchHits] = useState([]);
  const [eSrchRect, setESrchRect] = useState(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const addNewClient = async () => {
    const name = newClientName.trim(); if (!name) return;
    const { data: co } = await SB.from('companies').upsert({name,type:'client'},{onConflict:'name,type'}).select('id,name,pallet_info,shipping_address').single();
    if (co){ setClients(prev=>[...prev.filter(c=>c.id!==co.id),co]); f('clientId')(co.id); if(co.pallet_info&&!form.pallet)f('pallet')(co.pallet_info); if(co.shipping_address&&!form.delivery_address)f('delivery_address')(co.shipping_address); }
    setShowNewClient(false); setNewClientName('');
  };
  const [saveMsg, setSaveMsg] = useState('');
  const saveAsProductsAndQuotes = async () => {
    const filled = items.filter(it=>it.desc.trim());
    if (!filled.length){ setSaveMsg('error:Add at least one product description first.'); setTimeout(()=>setSaveMsg(''),3000); return; }
    const clientName = (clients.find(c=>c.id===form.clientId)||po.client||{}).name||'';
    const factoryName = po.companies?.name||'';
    let saved=0, errors=[];
    for (const it of filled){
      const name = it.desc.trim();
      // Save to products catalog — check first to avoid duplicates
      const { data: existing } = await SB.from('products').select('id').eq('name',name).maybeSingle();
      if (!existing) {
        const { error: pErr } = await SB.from('products').insert({name, sku:it.prodId||null});
        if (pErr) errors.push('Product: '+pErr.message);
      }
      // Save as quote — tiers as plain array (not stringified)
      const tier = {qty:Number(it.qty)||1, exw:Number(it.price)||0, ship:0, freightAir:0, freightOcean:0, landed:Number(it.price)||0, client:Number(it.price)||0};
      const { error: qErr } = await SB.from('quotes').insert({
        product:name, sku:it.prodId||null, client:clientName||null, factory:factoryName||null,
        quote_date:form.date||new Date().toISOString().split('T')[0],
        tiers:[tier], status:'active'
      });
      if (qErr) errors.push('Quote: '+qErr.message);
      else saved++;
    }
    if (errors.length) { setSaveMsg('error:'+errors[0]); }
    else { setSaveMsg(saved+' product'+(saved!==1?'s':'')+' saved to Products and Quotes.'); }
    setTimeout(()=>setSaveMsg(''),4000);
  };
  useEffect(()=>{
    Promise.all([
      SB.from('products').select('id,sku,name').order('sku',{nullsFirst:false}),
      SB.from('purchase_order_items').select('description').not('description','is',null).limit(200),
      SBQ.from('quotes').select('product').not('product','is',null).limit(300),
      SB.from('companies').select('id,name,pallet_info,shipping_address').eq('type','client').order('name')
    ]).then(([{data:pro},{data:itmD},{data:qProds},{data:cli}])=>{
      setProducts(pro||[]);
      setClients(cli||[]);
      const poDescs=(itmD||[]).map(it=>it.description||'').filter(Boolean);
      const qNames=(qProds||[]).map(q=>q.product||'').filter(Boolean);
      setRecentDescs([...new Set([...poDescs,...qNames])]);
    });
  },[]);
  const handleEProdInput = (i,v,el) => {
    setItem(i,'desc',v);
    if(v.trim().length>0){
      const lv=v.toLowerCase();
      const cat=(products||[]).filter(p=>(p.name||'').toLowerCase().includes(lv)||(p.sku||'').toLowerCase().includes(lv)).map(p=>({id:p.id,name:p.name,sku:p.sku||'',recent:false}));
      const rec=recentDescs.filter(d=>d.toLowerCase().includes(lv)&&!cat.some(c=>c.name===d)).slice(0,5).map(d=>({id:null,name:d,sku:'',recent:true}));
      const h=[...cat,...rec].slice(0,8);
      setESrchHits(h); setESrchIdx(i);
      if(el){const r=el.getBoundingClientRect();setESrchRect({top:r.bottom+2,left:r.left,w:Math.max(r.width,240)});}
    } else { setESrchIdx(-1); setESrchHits([]); setESrchRect(null); }
  };
  const pickEProd = async (i,p) => {
    setItem(i,'desc',p.name); setItem(i,'prodId',p.id||'');
    setESrchIdx(-1); setESrchHits([]); setESrchRect(null);
    try {
      const {data} = await SB.from('purchase_order_items').select('carton_info,ci_value').ilike('description',p.name).limit(1);
      if (data?.[0]) {
        if (data[0].carton_info) setItem(i,'carton',data[0].carton_info);
        if (data[0].ci_value!=null) setItem(i,'ci',String(data[0].ci_value));
      }
    } catch(e){}
  };
  const save = async () => {
    if(!form.num){alert('PO number required');return;}
    const { error } = await SB.from('purchase_orders').update({
      order_number:form.num, order_date:form.date||null, requested_ship_date:form.ship||null, cargo_ready_date:form.ship||null, cancel_date:form.cancel||null,
      incoterm:form.inco||null, payment_terms:form.pay||null, deposit_percent:Number(form.dep)||null,
      mold_fee:Number(form.mold)||0, sample_fee:Number(form.sample)||0, currency:form.currency,
      notes:form.notes||null, status:form.status, pallet_info:form.pallet||null,
      client_company_id: form.clientId||null,
      needs_samples:!!form.needs_samples, sample_type:form.needs_samples?(form.sample_type||null):null, sample_qty:form.needs_samples?(Number(form.sample_qty)||null):null, sample_date:form.needs_samples?(form.sample_date||null):null,
      testing_required:!!form.testing_required, delivery_address:form.delivery_address||null, shipping_method:form.shipping_method||null,
      updated_at:new Date().toISOString()
    }).eq('id',po.id);
    if(error){alert('Error: '+error.message);return;}
    // Non-destructive item sync: never wipe all items.
    const valid=items.filter(it=>(it.prodId||(it.desc||'').trim()) && Number(it.qty)>0);
    const hadItems=(initialItems||[]).length>0;
    if(valid.length===0 && hadItems){
      alert('No valid line items to save — leaving existing items untouched to prevent data loss. Each item needs a product/description and a quantity.');
      return;
    }
    const rowFor=it=>({product_id:it.prodId||null,quantity:Number(it.qty),unit_price:Number(it.price)||0,currency:form.currency,ci_value:Number(it.ci)||null,carton_info:it.carton||null,vpn:it.vpn||null,master_sku:it.masterSku||null,pack_sku:it.packSku||null,baby_sku:it.babySku||null,retail_price:it.retailPrice?Number(it.retailPrice):null});
    for(const it of valid){
      const base=rowFor(it); const desc=(it.desc||'').trim();
      if(it.id){
        let { error:e1 } = await SB.from('purchase_order_items').update({...base,description:desc||null}).eq('id',it.id);
        if(e1 && /description/i.test(e1.message)) await SB.from('purchase_order_items').update(base).eq('id',it.id);
      } else {
        let { error:e1 } = await SB.from('purchase_order_items').insert({...base,purchase_order_id:po.id,description:desc||null});
        if(e1 && /description/i.test(e1.message)) await SB.from('purchase_order_items').insert({...base,purchase_order_id:po.id});
      }
    }
    // delete only rows the user explicitly removed
    const keepIds=valid.filter(it=>it.id).map(it=>it.id);
    const removed=(initialItems||[]).map(it=>it.id).filter(Boolean).filter(oid=>!keepIds.includes(oid));
    if(removed.length) await SB.from('purchase_order_items').delete().in('id',removed);
    onSaved();
  };
  return (
    <>
    {showPicker && <QuotePickerModal priceField="landed" onPick={onPickPOItem} onClose={()=>setShowPicker(false)} />}
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box modal-lg">
        <div className="modal-head"><h3>Edit Purchase Order</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>PO Number *</label><input className="form-input" value={form.num} onChange={e=>f('num')(e.target.value)} /></div>
            <div><label>Status</label><select className="form-select" value={form.status} onChange={e=>f('status')(e.target.value)}>{SO_STATUSES.map(s=><option key={s} value={s}>{(SO_SM[s]?.label)||s.replace(/_/g,' ')}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Order Date</label><input type="date" className="form-input" value={form.date} onChange={e=>f('date')(e.target.value)} /></div>
            <div><label>CRD <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>cargo ready date</span></label><input type="date" className="form-input" value={form.ship} onChange={e=>f('ship')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Cancel Date</label><input type="date" className="form-input" value={form.cancel} onChange={e=>f('cancel')(e.target.value)} /></div>
            <div><label>Incoterm</label><input className="form-input" value={form.inco} onChange={e=>f('inco')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Payment Terms</label><input className="form-input" value={form.pay} onChange={e=>f('pay')(e.target.value)} /></div>
            <div></div>
          </div>
          <span className="form-section-label">Line Items</span>
          <table className="items-table">
            <thead><tr><th style={{width:'40%'}}>Product</th><th>Qty</th><th>Unit Price</th><th style={{width:'36px'}}></th></tr></thead>
            <tbody>
              {items.map((it,i)=>(
                <React.Fragment key={i}>
                  <tr>
                    <td>
                      <div style={{position:'relative'}}>
                        <input value={it.desc} onChange={e=>handleEProdInput(i,e.target.value,e.target)} onBlur={()=>setTimeout(()=>{setESrchIdx(-1);setESrchHits([]);setESrchRect(null);},200)} placeholder="Type to search products…" />
                        {eSrchIdx===i && eSrchHits.length>0 && (
                          <div className="prod-suggestions">
                            {eSrchHits.map(p=>(
                              <div key={p.id} className="prod-sugg-item" onMouseDown={()=>pickEProd(i,p)}>
                                <span style={{fontWeight:600}}>{p.name}</span>{p.sku&&<span style={{fontSize:'11px',color:'var(--muted)',marginLeft:'8px'}}>{p.sku}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td><input type="number" value={it.qty} onChange={e=>setItem(i,'qty',e.target.value)} placeholder="0" /></td>
                    <td><input type="number" step="0.00001" value={it.price} onChange={e=>setItem(i,'price',e.target.value)} placeholder="0.00" /></td>
                    <td><button className="rm" onClick={()=>rmItem(i)}>×</button></td>
                  </tr>
                  <tr className="item-sub-row">
                    <td colSpan={4}>
                      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',padding:'4px 0 4px'}}>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>CI Value ($)</span><input type="number" step="0.00001" className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.ci||''} onChange={e=>setItem(i,'ci',e.target.value)} placeholder="0.00" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'1 1 180px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>Carton info</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.carton||''} onChange={e=>setItem(i,'carton',e.target.value)} placeholder="e.g. 12 pcs/ctn, 60×40×30 cm, 11 kg" /></div>
                      </div>
                      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',padding:'0 0 8px'}}>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 90px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>VPN #</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.vpn||''} onChange={e=>setItem(i,'vpn',e.target.value)} placeholder="VPN" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Master SKU</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.masterSku||''} onChange={e=>setItem(i,'masterSku',e.target.value)} placeholder="Master" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Pack SKU</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.packSku||''} onChange={e=>setItem(i,'packSku',e.target.value)} placeholder="Pack" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Baby SKU</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.babySku||''} onChange={e=>setItem(i,'babySku',e.target.value)} placeholder="Baby" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Retail Price</span><input type="number" step="0.00001" className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.retailPrice||''} onChange={e=>setItem(i,'retailPrice',e.target.value)} placeholder="0.00" /></div>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'16px'}} onClick={addItem}>+ Add Item</button>
          <span className="form-section-label">Preproduction Samples</span>
          <div style={{padding:'4px 0 14px'}}>
            <label style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'13.5px',cursor:'pointer',fontFamily:'var(--sans)',textTransform:'none',letterSpacing:0,color:'var(--ink)',fontWeight:400}}>
              <input type="checkbox" checked={!!form.needs_samples} onChange={e=>f('needs_samples')(e.target.checked)} style={{width:'16px',height:'16px',accentColor:'var(--accent)'}} />
              Do we need preproduction samples for this order?
            </label>
            {form.needs_samples && (
              <>
              <div style={{marginTop:'12px'}}>
                <label>Sample types <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(select all that apply)</span></label>
                <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'6px'}}>
                  {['TOP','Model Store','Preproduction','Salesman','Photo/PR'].map(t=>{ const sel=(form.sample_type||'').split(',').map(x=>x.trim()).filter(Boolean); const on=sel.includes(t); return (
                    <button key={t} type="button" onClick={()=>{ markDirty(); const next=on?sel.filter(x=>x!==t):[...sel,t]; f('sample_type')(next.join(', ')); }} style={{padding:'7px 13px',borderRadius:'9px',border:'1px solid '+(on?'transparent':'var(--line)'),background:on?'var(--accent)':'#fff',color:on?'#fff':'var(--ink-2)',fontSize:'12.5px',fontWeight:500,cursor:'pointer'}}>{on?'✓ ':''}{t}</button>
                  ); })}
                </div>
              </div>
              <div className="form-row-2" style={{marginTop:'12px'}}>
                <div><label>Quantity needed</label><input type="number" className="form-input" value={form.sample_qty||''} onChange={e=>f('sample_qty')(e.target.value)} placeholder="e.g. 3" /></div>
                <div><label>Sample date <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(when due)</span></label><input type="date" className="form-input" value={form.sample_date||''} onChange={e=>f('sample_date')(e.target.value)} /></div>
              </div>
              </>
            )}
          </div>
          <span className="form-section-label">Fees & Currency</span>
          <div className="form-row-3">
            <div><label>Mold / Tooling</label><input type="number" className="form-input" value={form.mold} onChange={e=>f('mold')(e.target.value)} /></div>
            <div><label>Sample Fee</label><input type="number" className="form-input" value={form.sample} onChange={e=>f('sample')(e.target.value)} /></div>
            <div><label>Currency</label><select className="form-select" value={form.currency} onChange={e=>f('currency')(e.target.value)}><option>USD</option><option>CNY</option><option>VND</option><option>EUR</option></select></div>
          </div>
          <div className="form-row"><label>Client <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(for tracking &amp; inventory)</span></label>
            <select className="form-select" value={form.clientId} onChange={e=>{const c=clients.find(x=>x.id===e.target.value);setForm(prev=>({...prev,clientId:e.target.value,pallet:(c?.pallet_info&&!prev.pallet)?c.pallet_info:prev.pallet,delivery_address:(c?.shipping_address&&!prev.delivery_address)?c.shipping_address:prev.delivery_address}));}}>
              <option value="">Unassigned</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!showNewClient
              ? <button className="btn btn-ghost btn-sm" style={{marginTop:'8px'}} onClick={()=>setShowNewClient(true)}>+ New client</button>
              : <div style={{display:'flex',gap:'8px',marginTop:'8px',alignItems:'center'}}>
                  <input className="form-input" style={{flex:1}} placeholder="Client name…" value={newClientName} onChange={e=>setNewClientName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNewClient()} autoFocus />
                  <button className="btn btn-dark btn-sm" onClick={addNewClient}>Add</button>
                  <button className="btn btn-ghost btn-sm" onClick={()=>{setShowNewClient(false);setNewClientName('');}}>✕</button>
                </div>
            }
          </div>
          <div className="form-row"><label>Notes</label><textarea className="form-textarea" value={form.notes} onChange={e=>f('notes')(e.target.value)} /></div>
          <span className="form-section-label">Compliance & Delivery</span>
          <div className="form-row-2">
            <div><label>Shipping Method</label>
              <select className="form-select" value={form.shipping_method} onChange={e=>f('shipping_method')(e.target.value)}>
                <option value="">— select —</option>
                <option value="FedEx">FedEx</option>
                <option value="Sine Trading">Sine Trading</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
              <label style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'13.5px',cursor:'pointer',fontFamily:'var(--sans)',textTransform:'none',letterSpacing:0,color:'var(--ink)',fontWeight:400,marginBottom:'2px'}}>
                <input type="checkbox" checked={!!form.testing_required} onChange={e=>f('testing_required')(e.target.checked)} style={{width:'16px',height:'16px',accentColor:'#7c3aed'}} />
                Testing Required
              </label>
            </div>
          </div>
          <div className="form-row"><label>Delivery Address</label><textarea className="form-textarea" rows={3} value={form.delivery_address} onChange={e=>f('delivery_address')(e.target.value)} placeholder="Full delivery address for factory reference" /></div>
        </div>
        <div className="modal-foot" style={{flexWrap:'wrap',gap:'10px'}}>
          {saveMsg && (
            <div style={{flex:'0 0 100%',padding:'8px 12px',borderRadius:'8px',fontSize:'13px',fontWeight:500,
              background:saveMsg.startsWith('error:')?'#fef2f2':'#d1fae5',
              color:saveMsg.startsWith('error:')?'#991b1b':'#065f46'}}>
              {saveMsg.startsWith('error:')?'⚠ '+saveMsg.slice(6):'✓ '+saveMsg}
            </div>
          )}
          {/* Disabled, not removed. The title lives on the wrapper because a disabled
              button does not reliably fire hover events, so a title on the button
              itself would never surface. marginRight:auto moves with it -- the span
              is the flex child now. */}
          <span title="Disabled — this action has known defects and has never completed successfully. Ask Matt." style={{marginRight:'auto',display:'inline-flex'}}>
            <button className="btn btn-ghost btn-sm" style={{color:'var(--accent)',opacity:.45}} disabled onClick={saveAsProductsAndQuotes}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:'4px'}}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save as products &amp; quotes
            </button>
          </span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={save}>Save Changes</button>
        </div>
      </div>
    </div>
    {eSrchIdx>=0 && eSrchHits.length>0 && eSrchRect && typeof window!=='undefined' && createPortal(
      <div style={{position:'fixed',top:eSrchRect.top,left:eSrchRect.left,width:eSrchRect.w,background:'#fff',border:'1px solid #e2e8f0',borderRadius:'10px',boxShadow:'0 8px 24px rgba(0,0,0,.16)',zIndex:99999,maxHeight:'220px',overflowY:'auto'}}>
        {eSrchHits.map(p=>(
          <div key={p.id||p.name} style={{padding:'10px 14px',fontSize:'13px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}} onMouseDown={()=>pickEProd(eSrchIdx,p)}>
            <span style={{fontWeight:600,color:'#0b1120'}}>{p.name}</span>
            <span style={{fontSize:'11px',color:'#94a3b8'}}>{p.sku||''}{p.recent?' recent':''}</span>
          </div>
        ))}
      </div>,
      document.body
    )}
    </>
  );
}

// ── Companies ────────────────────────────────────────────────────────────────
// ── Company type: stored value → display label ───────────────────────────────
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ THE LABEL IS THE ONLY THING THAT CHANGES. THE STORED VALUE MUST NOT.       │
// │                                                                           │
// │ companies.type is matched as a literal lowercase string all over this      │
// │ codebase -- the RFQ picker's                                              │
// │ .in('type',['carrier','freight_forwarder']), the shipment carrier lists,   │
// │ every .eq('type','client') and .eq('type','factory') lookup, and the       │
// │ onConflict:'name,type' upserts that create companies from a quote. It is   │
// │ also half of a UNIQUE constraint.                                          │
// │                                                                           │
// │ Capitalising what is STORED would silently empty every one of those --     │
// │ no error, just filters that stop matching and pickers that render blank.   │
// │ So the pairs below are [value, label]: the left side is written to the     │
// │ database and compared against, the right side is only ever rendered.       │
// └───────────────────────────────────────────────────────────────────────────┘
//
// One list, used by both company modals. They previously held identical copies
// of the value array and each did its own `.replace(/_/g,' ')` at render, which
// is how "freight forwarder" reached the dropdown in lowercase in two places at
// once. Order preserved from those arrays, so no dropdown reorders.
//
// Not merged with Companies' own TYPE_LABELS: that one is plural and titles a
// tab ("Freight Forwarders"), where these are singular and name one company's
// type. Same words, different grammatical job.
const COMPANY_TYPES = [
  ['client',            'Client'],
  ['factory',           'Factory'],
  ['carrier',           'Carrier'],
  ['freight_forwarder', 'Freight Forwarder'],
];

function Companies() {
  const TYPE_LABELS = { client:'Clients', factory:'Factories', carrier:'Carriers', freight_forwarder:'Freight Forwarders' };
  const TYPE_KEYS = Object.keys(TYPE_LABELS);
  const [tab, setTab]     = useState(0);
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId]   = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await SB.from('companies')
      .select('*,contacts(full_name,email,phone,is_primary)')
      .eq('type', TYPE_KEYS[tab]).order('name');
    setRows(data||[]); setLoading(false);
  };
  useEffect(() => { load(); setSearch(''); }, [tab]);

  const shown = search.trim()
    ? rows.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.email||'').toLowerCase().includes(search.toLowerCase()))
    : rows;

  return (
    <>
      {/* ── Type tabs ── */}
      <div className="co-tabs">
        {TYPE_KEYS.map((t,i) => (
          <button key={t} className={'co-tab' + (i===tab?' active':'')} onClick={()=>setTab(i)}>
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* ── Search + count ── */}
      <div className="co-toolbar">
        <div className="co-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="co-search" placeholder={'Search ' + TYPE_LABELS[TYPE_KEYS[tab]].toLowerCase() + '…'} value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <span style={{fontSize:12,color:'var(--muted)',fontFamily:'var(--mono)'}}>{shown.length} {shown.length===1 ? TYPE_KEYS[tab].replace(/_/g,' ') : TYPE_LABELS[TYPE_KEYS[tab]].toLowerCase()}</span>
      </div>

      {/* ── Grid ── */}
      {loading ? <div className="loading">Loading…</div> : shown.length === 0 ? (
        <div className="empty">
          <div className="ico">🏢</div>
          <h3>{search ? 'No matches' : 'No ' + TYPE_LABELS[TYPE_KEYS[tab]].toLowerCase() + ' yet'}</h3>
          <p>{search ? 'Try a different search.' : 'Add your first to get started.'}</p>
        </div>
      ) : (
        <div className="co-grid">
          {shown.map(c => {
            const primary = (c.contacts||[]).find(x=>x.is_primary) || (c.contacts||[])[0] || {};
            const col = companyColor(c.name);
            return (
              <div key={c.id} className="co-card" onClick={()=>setOpenId(c.id)}>
                <div className="co-card-head">
                  <div className="co-avatar" style={{background:col}}>{initials(c.name)}</div>
                  <div className="co-card-meta">
                    <div className="co-card-name">{c.name}</div>
                    {c.vendor_number && <div className="co-card-sub mono">#{c.vendor_number}</div>}
                  </div>
                </div>
                <div className="co-card-body">
                  {primary.full_name && (
                    <div className="co-card-row">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      <span>{primary.full_name}</span>
                    </div>
                  )}
                  {(primary.email||c.email) && (
                    <div className="co-card-row">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                      <span>{primary.email||c.email}</span>
                    </div>
                  )}
                  {(primary.phone||c.phone) && (
                    <div className="co-card-row">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.62 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.97-.87a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 17z"/></svg>
                      <span>{primary.phone||c.phone}</span>
                    </div>
                  )}
                </div>
                <div className="co-card-foot">
                  <span className="co-contact-count">{(c.contacts||[]).length} contact{(c.contacts||[]).length!==1?'s':''}</span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <CreateCompanyModal onClose={()=>setShowCreate(false)} onCreated={()=>{setShowCreate(false);load();}} />}
      {openId && <CompanyDetailModal id={openId} onClose={()=>setOpenId(null)} onSaved={()=>{setOpenId(null);load();}} />}
    </>
  );
}

// ── Company Detail + Edit ──────────────────────────────────────────────────────
function CompanyDetailModal({ id, onClose, onSaved }) {
  // Two returns share this guard -- the loading branch and the loaded one. The
  // loading branch has no controls, so it closes silently.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [co, setCo] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(null);
  useEffect(()=>{
    (async()=>{
      const { data:c } = await SB.from('companies').select('*').eq('id',id).single();
      const { data:cc } = await SB.from('contacts').select('*').eq('company_id',id).order('is_primary',{ascending:false});
      setCo(c); setContacts(cc||[]);
      setForm({ name:c?.name||'', type:c?.type||'client', email:c?.email||'', phone:c?.phone||'', website:c?.website||'', vendor_number:c?.vendor_number||'', pallet_info:c?.pallet_info||'', po_notes:c?.po_notes||'', billing_address:c?.billing_address||'', shipping_address:c?.shipping_address||'' });
    })();
  },[id]);
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const setC = (i,k,v) => setContacts(prev=>prev.map((c,idx)=>idx===i?{...c,[k]:v}:c));
  const addContact = () => setContacts(prev=>[...prev,{__new:true,company_id:id,full_name:'',email:'',phone:'',is_primary:prev.length===0}]);
  const save = async () => {
    if(!form.name){alert('Name required');return;}
    await SB.from('companies').update({name:form.name,type:form.type,email:form.email||null,phone:form.phone||null,website:form.website||null,vendor_number:form.vendor_number||null,pallet_info:form.pallet_info||null,po_notes:form.po_notes||null,billing_address:form.billing_address||null,shipping_address:form.shipping_address||null}).eq('id',id);
    for(const c of contacts){
      if(!(c.full_name||'').trim()) continue;
      if(c.__new) await SB.from('contacts').insert({company_id:id,full_name:c.full_name,email:c.email||null,phone:c.phone||null,is_primary:!!c.is_primary});
      else await SB.from('contacts').update({full_name:c.full_name,email:c.email||null,phone:c.phone||null,is_primary:!!c.is_primary}).eq('id',c.id);
    }
    onSaved();
  };
  const deleteCompany = async () => {
    const { error } = await SB.from('companies').delete().eq('id',id);
    if (error){ alert('Error: '+error.message); return; }
    onSaved();
  };
  const [confirmDel, setConfirmDel] = useState(false);
  if(!co||!form) return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}><div ref={cardRef} className="modal-box"><div className="modal-body"><div className="loading">Loading…</div></div></div></div>
  );
  const col = companyColor(co.name);
  return (
    <>
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box">
        <div className="modal-head" style={{gap:'12px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',minWidth:0}}>
            <span style={{width:'34px',height:'34px',borderRadius:'9px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:600,fontFamily:'var(--mono)',color:'#0b1120',background:col}}>{initials(co.name)}</span>
            <h3 style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{co.name}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!edit ? (
            <>
              <div style={{display:'flex',gap:'8px',marginBottom:'18px'}}><Badge status={co.type} /></div>
              <div className="detail-grid" style={{gridTemplateColumns:'1fr',gap:'0'}}>
                {[['Email',co.email],['Phone',co.phone],['Website',co.website],['Billing Address',co.billing_address],['Shipping Address',co.shipping_address],...(co.type==='client'?[['Vendor #',co.vendor_number],['Pallet info',co.pallet_info]]:[])].map(([l,v])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',gap:'16px',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
                    <span style={{color:'var(--muted)',fontSize:'12px',whiteSpace:'nowrap'}}>{l}</span><span style={{fontSize:'13px',textAlign:'right',whiteSpace:'pre-wrap'}}>{v||'—'}</span>
                  </div>
                ))}
              </div>
              <span className="form-section-label">Contacts</span>
              {contacts.length? contacts.map((c,i)=>(
                <div key={i} style={{padding:'10px 0',borderBottom:'1px solid var(--line-2)'}}>
                  <div style={{fontWeight:500,fontSize:'13.5px'}}>{c.full_name} {c.is_primary&&<span style={{fontSize:'10px',color:'var(--accent)',fontFamily:'var(--mono)'}}>· PRIMARY</span>}</div>
                  <div style={{fontSize:'12.5px',color:'var(--muted)'}}>{[c.email,c.phone].filter(Boolean).join('  ·  ')||'—'}</div>
                </div>
              )) : <div style={{fontSize:'13px',color:'var(--muted)'}}>No contacts yet.</div>}
            </>
          ) : (
            <>
              <div className="form-row-2">
                <div><label>Company Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
                <div><label>Type</label><select className="form-select" value={form.type} onChange={e=>f('type')(e.target.value)}>{COMPANY_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
              </div>
              <div className="form-row-2">
                <div><label>Email</label><input className="form-input" value={form.email} onChange={e=>f('email')(e.target.value)} /></div>
                <div><label>Phone</label><input className="form-input" value={form.phone} onChange={e=>f('phone')(e.target.value)} /></div>
              </div>
              <div className="form-row"><label>Website</label><input className="form-input" value={form.website} onChange={e=>f('website')(e.target.value)} placeholder="https://" /></div>
              <div className="form-row"><label>Billing Address</label><textarea className="form-input" rows={3} value={form.billing_address} onChange={e=>f('billing_address')(e.target.value)} placeholder="Street, city, state / province, postal code, country" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
              <div className="form-row"><label>Shipping Address <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(prefills the ship-to on new orders)</span></label><textarea className="form-input" rows={3} value={form.shipping_address} onChange={e=>f('shipping_address')(e.target.value)} placeholder="Street, city, state / province, postal code, country" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
              {form.type==='client' && (
                <div className="form-row-2">
                  <div><label>Vendor # <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(internal — our # with this client)</span></label><input className="form-input" value={form.vendor_number} onChange={e=>f('vendor_number')(e.target.value)} /></div>
                  <div><label>Pallet info <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(autofills onto their POs)</span></label><input className="form-input" value={form.pallet_info} onChange={e=>f('pallet_info')(e.target.value)} placeholder="e.g. 48x40 GMA, max 60 cartons/pallet" /></div>
                  <div style={{gridColumn:'1 / -1'}}><label>PO Notes <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(compliance terms printed on every PO for this client)</span></label><textarea className="form-input" rows={5} value={form.po_notes} onChange={e=>f('po_notes')(e.target.value)} placeholder={'e.g.\\nMust ship even case packs only\\nPacking slip must show PO#, vendor name, weight, carton dims\\nNo phthalates, No PVC'} style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
                </div>
              )}
              <span className="form-section-label">Contacts</span>
              {contacts.map((c,i)=>(
                <div key={i} className="form-row-2" style={{marginBottom:'10px'}}>
                  <div><label>Name</label><input className="form-input" value={c.full_name||''} onChange={e=>setC(i,'full_name',e.target.value)} /></div>
                  <div><label>Email</label><input className="form-input" value={c.email||''} onChange={e=>setC(i,'email',e.target.value)} /></div>
                  <div><label>Phone</label><input className="form-input" value={c.phone||''} onChange={e=>setC(i,'phone',e.target.value)} /></div>
                  <div style={{display:'flex',alignItems:'flex-end',gap:'8px'}}><label style={{display:'flex',alignItems:'center',gap:'6px',textTransform:'none',letterSpacing:0,fontFamily:'var(--sans)',fontSize:'12.5px',color:'var(--ink-2)',margin:0}}><input type="checkbox" checked={!!c.is_primary} onChange={e=>setC(i,'is_primary',e.target.checked)} /> Primary contact</label></div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={addContact}>+ Add Contact</button>
            </>
          )}
        </div>
        <div className="modal-foot">
          {!edit ? (
            <><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-ghost btn-sm" style={{color:'var(--hot)',marginRight:'auto'}} onClick={()=>setConfirmDel(true)}>Delete</button><button className="btn btn-dark" onClick={()=>setEdit(true)}>Edit</button></>
          ) : (
            <><button className="btn btn-ghost" onClick={()=>setEdit(false)}>Cancel</button><button className="btn btn-dark" onClick={save}>Save Changes</button></>
          )}
        </div>
      </div>
    </div>
    {confirmDel && <ConfirmModal title={'Delete '+co.name+'?'} message="All contacts will be removed. This cannot be undone." onConfirm={()=>{setConfirmDel(false);deleteCompany();}} onCancel={()=>setConfirmDel(false)} />}
    </>
  );
}

// ── Products ─────────────────────────────────────────────────────────────────
// canCreateProducts is a derived boolean rather than the role string, so the policy
// stays beside ROLE_PAGES instead of scattering role names through view components.
// It is intent, not enforcement: vessl.products carries a permissive `true` policy
// (products_auth_all), so any authenticated @kinguniversal.com user can insert through
// the API regardless. Locking that down is an RLS change, deliberately not made here.
function Products({ navigate, canCreateProducts = true }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState('All');
  const [search, setSearch] = useState('');
  const [poQuote, setPoQuote] = useState(null);
  const [viewQuote, setViewQuote] = useState(null);
  const [prods, setProds] = useState([]);
  const [activeF, setActiveF] = useState('All');
  const load = async () => {
    setLoading(true);
    const [qRes, pRes] = await Promise.all([
      SBQ.from('quotes').select('*').order('created_at',{ascending:false}),
      SB.from('products').select('id,sku,name,active'),
    ]);
    setQuotes(qRes.data||[]); setProds(pRes.data||[]); setLoading(false);
  };
  useEffect(()=>{ load(); },[]);
  // SKU alone is not enough -- products_sku_name_key is UNIQUE on (sku, name) and one
  // SKU can carry several products (LL1-1629 has three sizes). The name alone IS enough
  // to key on, so a SKU-less quote row still gets a key ('' + '|' + name) and can match
  // a SKU-less product. That is what lets a product created from such a row match back
  // on the very next render instead of being inserted again on the next click.
  // Only a row with no name at all is unkeyable.
  const prodKey = (sku, name) => {
    const n = (name||'').trim();
    return n ? (sku||'').trim()+'|'+n : null;
  };
  const prodBy = new Map(prods.map(p=>[prodKey(p.sku,p.name), p]).filter(([k])=>k));
  const matchOf = q => { const k = prodKey(q.sku, q.product); return k ? (prodBy.get(k)||null) : null; };

  // '' is the Not set option; the two real states arrive as strings from the <select>.
  const parseActive = v => (v === '' ? null : v === 'true');
  const activeValue = a => (a == null ? '' : (a ? 'true' : 'false'));
  // Re-reads the row a 23505 says already exists. sku null needs .is(), not .eq() --
  // PostgREST renders .eq('sku', null) as sku=eq.null, which matches nothing, and the
  // insert would then repeat forever.
  const fetchExisting = async (sku, name) => {
    let qy = SB.from('products').select('id,sku,name,active').eq('name', name);
    qy = sku ? qy.eq('sku', sku) : qy.is('sku', null);
    const { data } = await qy.limit(1);
    return (data && data[0]) || null;
  };
  // One write per interaction, never a delete or an overwrite of another product.
  // No optimistic update: prods is only touched after the database agrees, so a
  // rejected write leaves the cell showing what is actually stored.
  const [busyId, setBusyId] = useState(null);
  const setActive = async (q, prod, value) => {
    setBusyId(q.id);
    try {
      if (prod) {
        const { error } = await SB.from('products').update({ active: value }).eq('id', prod.id);
        if (error) { window._toast?.('Could not change active state — '+error.message,'err'); return; }
        setProds(prev => prev.map(p => p.id===prod.id ? {...p, active:value} : p));
        return;
      }
      const sku = (q.sku||'').trim() || null, name = (q.product||'').trim();
      if (!name) return;
      const { data, error } = await SB.from('products').insert({ sku, name, active:value }).select('id,sku,name,active').single();
      if (!error && data) {
        // Adopting the returned row is what turns the hollow ring filled without a
        // reload -- and proves the widened key matched it back.
        setProds(prev => [...prev, data]);
        return;
      }
      // products_name_nullsku_key (or products_sku_name_key) fired: somebody got here
      // first. Their decision stands -- adopt the stored row rather than re-applying
      // ours, so a race cannot quietly overwrite a call someone else made.
      if (error && error.code === '23505') {
        const existing = await fetchExisting(sku, name);
        if (existing) {
          setProds(prev => prev.some(p=>p.id===existing.id) ? prev : [...prev, existing]);
          window._toast?.('“'+name+'” already exists — showing the saved state instead','info');
          return;
        }
      }
      window._toast?.('Could not create product — '+(error?.message||'unknown error'),'err');
    } finally { setBusyId(null); }
  };
  const tiersOf = q => { try { return Array.isArray(q.tiers)?q.tiers:(q.tiers?JSON.parse(q.tiers):[]); } catch { return []; } };
  const activeFreight = t => { const ship=t.ship||'ocean'; return ship==='air'?(Number(t.freightAir??t.freightDuty)||0):(Number(t.freightOcean??t.freightDuty)||0); };
  const moldPer = (m,qty)=>{ const f=Number(m)||0,qn=Number(qty)||0; return (f<=0||qn<=0)?0:f/qn; };
  const tierMargin = (t,mold)=>{ const total=(Number(t.landed)||0)+activeFreight(t)+moldPer(mold,t.qty); const p=Number(t.client)||0; return p<=0?null:((p-total)/p)*100; };
  const clientPrices = q => tiersOf(q).map(t=>Number(t.client)||0).filter(Boolean);
  const priceRange = q => { const p=clientPrices(q); if(!p.length) return null; const lo=Math.min(...p),hi=Math.max(...p); return lo===hi?money(lo):`${money(lo)} – ${money(hi)}`; };
  const avgMargin = q => { const ms=tiersOf(q).map(t=>tierMargin(t,q.mold_fee)).filter(v=>v!=null); return ms.length?Math.round(ms.reduce((a,b)=>a+b,0)/ms.length):null; };

  const counts = {}; quotes.forEach(q=>{ const c=(q.client||'').trim()||'—'; counts[c]=(counts[c]||0)+1; });
  const clientList = Object.keys(counts).sort((a,b)=>a.localeCompare(b));
  const clientOptions = [
    { value:'All', label:'All Clients', count:quotes.length },
    ...clientList.map(c=>({ value:c, label:c, color:companyColor(c), count:counts[c] })),
  ];
  // Counted over quote rows, not products, so the numbers match what the table shows.
  // An unmatched row is neither active nor inactive and is excluded by either filter.
  // active is nullable and null means undecided, so only an explicit true or false is
  // counted -- an unruled product belongs to neither bucket.
  const activeCounts = quotes.reduce((a,q)=>{ const p=matchOf(q); if(p&&p.active!=null) a[p.active?'active':'inactive']++; return a; }, {active:0,inactive:0});
  const activeOptions = [
    { value:'All', label:'All', count:quotes.length },
    { value:'active', label:'Active', color:'var(--ok)', count:activeCounts.active },
    { value:'inactive', label:'Inactive', color:'var(--hot)', count:activeCounts.inactive },
  ];
  const filtered = quotes.filter(q=>{
    if(client!=='All' && ((q.client||'').trim()||'—')!==client) return false;
    if(activeF!=='All'){ const p=matchOf(q); if(!p||p.active==null) return false; if((activeF==='active')!==p.active) return false; }
    const s=search.toLowerCase(); if(!s) return true;
    return `${q.product} ${q.client} ${q.factory} ${q.sku} ${q.country}`.toLowerCase().includes(s);
  });

  return (
    <>
      <div className="prod-search" style={{marginBottom:'16px'}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input placeholder="Search products — name, client, factory, SKU…" value={search} onChange={e=>setSearch(e.target.value)} />
      </div>
      <div className="fs-row" style={{marginBottom:'20px'}}>
        <FilterSelect label="All Clients" value={client} onChange={setClient} options={clientOptions} />
        <FilterSelect label="All" value={activeF} onChange={setActiveF} options={activeOptions} />
      </div>
      {client!=='All' && (
        <div style={{display:'flex',alignItems:'center',gap:'8px',margin:'4px 0 16px',fontSize:'15px'}}>
          <button className="crumb" onClick={()=>setClient('All')}>‹ All Clients</button>
          <span style={{color:'var(--faint)'}}>/</span>
          <span style={{fontFamily:'var(--serif)',fontWeight:600}}>{client}</span>
          <span style={{color:'var(--muted)',fontSize:'12.5px'}}>{filtered.length} {filtered.length===1?'product':'products'}</span>
        </div>
      )}
      <div className="section-card">
        {loading ? <div className="loading">Loading products…</div> : filtered.length ? (
          <table className="data-table">
            <thead><tr><th>SKU / Product</th><th>Factory</th><th>Tiers</th><th>Client Price</th><th>Avg Margin</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {filtered.map(q=>{
                const col=companyColor(q.client); const tiers=tiersOf(q); const m=avgMargin(q); const prod=matchOf(q);
                return (
                  <tr key={q.id} onClick={()=>setViewQuote(q)} style={{cursor:'pointer'}}>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <span style={{width:'26px',height:'26px',borderRadius:'7px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:600,fontFamily:'var(--mono)',color:'#0b1120',background:col}}>{initials(q.client)}</span>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'260px',fontFamily:'var(--mono)'}}>{q.sku||'No SKU'}</div>
                          <div style={{fontSize:'11px',color:'var(--muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'260px'}}>{q.product||'Untitled'}{q.client?' · '+q.client:''}</div>
                        </div>
                      </div>
                    </td>
                    <td><div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'200px'}}>{q.factory||'—'}</div><div style={{fontSize:'11px',color:'var(--faint)'}}>{q.country||''}</div></td>
                    <td className="mono">{tiers.length}</td>
                    <td className="mono">{priceRange(q)||'—'}</td>
                    <td className="mono" style={{color:m==null?'var(--faint)':m<15?'var(--hot)':m<25?'var(--warn)':'var(--ok)'}}>{m==null?'—':m+'%'}</td>
                    {/* A FILLED dot means a product record exists — green/red/grey for
                        true/false/undecided. A HOLLOW ring means no product record does,
                        so this quote has drifted out of sync; setting it creates one.
                        The em dash is narrower still: no SKU and no name, nothing to key
                        on or create, so the control is disabled rather than misleading. */}
                    <td onClick={e=>e.stopPropagation()} style={{whiteSpace:'nowrap'}}>
                      {!prodKey(q.sku,q.product) ? (
                        <span style={{color:'var(--faint)'}} title="No SKU and no product name — this row cannot be matched to a product or given one.">—</span>
                      ) : (
                        <span style={{display:'inline-flex',alignItems:'center',gap:'7px'}}>
                          <span style={{width:'8px',height:'8px',borderRadius:'50%',flexShrink:0,boxSizing:'border-box',
                            ...(prod
                              ? {background: prod.active==null ? 'var(--muted)' : prod.active ? 'var(--ok)' : 'var(--hot)'}
                              : {background:'transparent', border:'1.5px solid var(--muted)'})}} />
                          <select
                            value={activeValue(prod ? prod.active : null)}
                            disabled={busyId===q.id || (!prod && !canCreateProducts)}
                            onChange={e=>setActive(q, prod, parseActive(e.target.value))}
                            aria-label={'Active state for '+(q.sku||q.product||'product')}
                            title={prod ? 'Active state for this product'
                              : canCreateProducts ? 'No product record yet — setting this creates one'
                              : 'No product record yet — creating one is not available for your role'}
                            style={{border:'1px solid var(--line)',borderRadius:'7px',padding:'3px 6px',fontSize:'11.5px',color:'var(--ink-2)',background:'#fff',fontFamily:'inherit',outline:'none',cursor:(busyId===q.id||(!prod&&!canCreateProducts))?'default':'pointer',opacity:(busyId===q.id||(!prod&&!canCreateProducts))?.55:1}}
                          >
                            <option value="">— Not set —</option>
                            <option value="true">Active</option>
                            <option value="false">Inactive</option>
                          </select>
                        </span>
                      )}
                    </td>
                    <td style={{textAlign:'right'}} onClick={e=>{e.stopPropagation();setPoQuote(q);}}><span className="pull-link">Create PO →</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No products</h3><p>{quotes.length? 'Nothing matches this filter.' : 'Create quotes in the Quotes tab — each one becomes a pullable product here.'}</p></div>}
      </div>
      {viewQuote && <ProductDetailModal quote={viewQuote} onClose={()=>setViewQuote(null)} onCreatePO={()=>{setPoQuote(viewQuote);setViewQuote(null);}} />}
      {poQuote && <CreatePOModal initialQuote={poQuote} onClose={()=>setPoQuote(null)} onCreated={id=>{setPoQuote(null);navigate('order-detail',{id});}} />}
    </>
  );
}

// ── Product Detail Modal ──────────────────────────────────────────────────────
function ProductDetailModal({quote:initQ, onClose, onCreatePO}){
  // Add/remove tier both change the tier rows, which ARE inputs, so the snapshot
  // sees them and no markDirty is needed.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [q,setQ]=useState(initQ);
  const [editing,setEditing]=useState(false);
  const [saving,setSaving]=useState(false);
  const tOf=q=>{try{const t=q.tiers;return Array.isArray(t)?t:(t?JSON.parse(t):[]);}catch{return [];}};
  const [tiers,setTiers]=useState(tOf(initQ));
  const [form,setForm]=useState({product:initQ.product||'',sku:initQ.sku||'',client:initQ.client||'',factory:initQ.factory||'',notes:initQ.notes||'',mold_fee:initQ.mold_fee!=null?String(initQ.mold_fee):'',sample_fee:initQ.sample_fee!=null?String(initQ.sample_fee):'',status:initQ.status||'active'});
  const f=k=>v=>setForm(prev=>({...prev,[k]:v}));
  const stf=(i,k,v)=>setTiers(prev=>prev.map((t,idx)=>idx===i?{...t,[k]:v}:t));
  const save=async()=>{
    setSaving(true);
    const {error}=await SB.from('quotes').update({product:form.product,sku:form.sku||null,client:form.client||null,factory:form.factory||null,notes:form.notes||null,mold_fee:Number(form.mold_fee)||null,sample_fee:Number(form.sample_fee)||null,tiers,status:form.status,updated_at:new Date().toISOString()}).eq('id',q.id);
    if(error){alert('Error: '+error.message);}
    else{setQ(prev=>({...prev,...form,tiers}));setEditing(false);}
    setSaving(false);
  };
  const mc=p=>p===null?'var(--muted)':p>=25?'#059669':p>=15?'#d97706':'#dc2626';
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box" style={{maxWidth:'680px'}}>
        <div className="modal-head">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <span style={{width:'36px',height:'36px',borderRadius:'9px',background:companyColor(q.client||''),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:700,color:'#fff',flexShrink:0}}>{initials(q.client||'?')}</span>
            <div><div style={{fontWeight:700,fontSize:'16px',color:'var(--ink)'}}>{q.product||'Product'}</div><div style={{fontSize:'12px',color:'var(--muted)'}}>{q.client||'—'}{q.factory?' · '+q.factory:''}{q.sku?' · '+q.sku:''}</div></div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!editing ? (
            <>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px',marginBottom:'20px'}}>
                {[['Product',q.product||'—'],['SKU',q.sku||'—'],['Status',q.status||'—'],['Client',q.client||'—'],['Factory',q.factory||'—'],['Mold Fee',q.mold_fee?money(q.mold_fee):'—']].map(([l,v])=>(
                  <div key={l}><div style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',marginBottom:'4px'}}>{l}</div><div style={{fontSize:'13px',fontWeight:500,color:'var(--ink)'}}>{v}</div></div>
                ))}
              </div>
              <span className="form-section-label">Pricing Tiers</span>
              {tiers.length ? (
                <div style={{overflowX:'auto',marginBottom:'16px'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12.5px',minWidth:'400px'}}>
                    <thead><tr style={{borderBottom:'1px solid var(--line-2)'}}>
                      {['Qty','EXW','Landed','Client Price','Margin'].map(h=><th key={h} style={{padding:'6px 10px',textAlign:h==='Qty'?'left':'right',fontSize:'9px',textTransform:'uppercase',letterSpacing:'.1em',color:'var(--muted)',fontWeight:600}}>{h}</th>)}
                    </tr></thead>
                    <tbody>{tiers.map((t,i)=>{
                      const cost=Number(t.landed)||0; const p=Number(t.client)||0;
                      const mgn=p>0?((p-cost)/p*100):null;
                      return (<tr key={i} style={{borderBottom:'1px solid var(--line-2)'}}>
                        <td style={{padding:'10px',fontFamily:'var(--mono)',fontWeight:600}}>{t.qty?new Intl.NumberFormat().format(t.qty):'—'}</td>
                        <td style={{padding:'10px',textAlign:'right',fontFamily:'var(--mono)'}}>{money(t.exw)}</td>
                        <td style={{padding:'10px',textAlign:'right',fontFamily:'var(--mono)'}}>{money(t.landed)}</td>
                        <td style={{padding:'10px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,color:p>0?'var(--ink)':'var(--muted)'}}>{p>0?money(t.client):'—'}</td>
                        <td style={{padding:'10px',textAlign:'right',fontFamily:'var(--mono)',color:mc(mgn)}}>{mgn!==null?mgn.toFixed(1)+'%':'—'}</td>
                      </tr>);
                    })}</tbody>
                  </table>
                </div>
              ) : <div style={{padding:'16px 0',color:'var(--muted)',fontSize:'13px',marginBottom:'16px'}}>No pricing tiers yet.</div>}
              {q.notes&&<div style={{fontSize:'13px',color:'var(--muted)',lineHeight:1.6}}>{q.notes}</div>}
            </>
          ) : (
            <>
              <div className="form-row-2"><div><label>Product Name</label><input className="form-input" value={form.product} onChange={e=>f('product')(e.target.value)} /></div><div><label>SKU</label><input className="form-input" value={form.sku} onChange={e=>f('sku')(e.target.value)} /></div></div>
              <div className="form-row-2"><div><label>Client</label><input className="form-input" value={form.client} onChange={e=>f('client')(e.target.value)} /></div><div><label>Factory</label><input className="form-input" value={form.factory} onChange={e=>f('factory')(e.target.value)} /></div></div>
              <div className="form-row-2">
                <div><label>Mold Fee</label><input type="number" step="0.01" className="form-input" value={form.mold_fee} onChange={e=>f('mold_fee')(e.target.value)} placeholder="0.00" /></div>
                <div><label>Status</label><select className="form-select" value={form.status} onChange={e=>f('status')(e.target.value)}>{['active','draft','archived'].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
              </div>
              <span className="form-section-label">Pricing Tiers</span>
              {tiers.map((t,i)=>(
                <div key={i} style={{background:'var(--line-2)',borderRadius:'8px',padding:'12px',marginBottom:'10px'}}>
                  <div style={{fontSize:'11px',fontWeight:700,color:'var(--muted)',marginBottom:'8px'}}>{'Tier '+(i+1)}</div>
                  <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                    {[['Qty','qty'],['EXW','exw'],['Ship','ship'],['Landed','landed'],['Client Price','client']].map(([lb,key])=>(
                      <div key={key} style={{display:'flex',flexDirection:'column',flex:'1 1 80px'}}>
                        <span style={{fontSize:'9px',textTransform:'uppercase',letterSpacing:'.08em',color:key==='client'?'#7c3aed':'var(--muted)',fontWeight:key==='client'?700:400,marginBottom:'4px'}}>{lb}</span>
                        <input type="number" step={key==='qty'?'1':'0.01'} className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={t[key]||''} onChange={e=>stf(i,key,e.target.value)} placeholder="0" />
                      </div>
                    ))}
                    <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                      <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--hot)',fontSize:'18px',padding:'0 4px'}} onClick={()=>setTiers(prev=>prev.filter((_,idx)=>idx!==i))}>×</button>
                    </div>
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{marginBottom:'12px'}} onClick={()=>setTiers(prev=>[...prev,{qty:'',exw:'',ship:0,freightAir:0,freightOcean:0,landed:'',client:''}])}>+ Add Tier</button>
              <div><label>Notes</label><textarea className="form-textarea" rows={3} value={form.notes} onChange={e=>f('notes')(e.target.value)} /></div>
            </>
          )}
        </div>
        <div className="modal-foot">
          {!editing ? (
            <><button className="btn btn-ghost btn-sm" style={{marginRight:'auto',color:'var(--accent)'}} onClick={onCreatePO}>Create PO from this →</button><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-dark" onClick={()=>setEditing(true)}>Edit</button></>
          ) : (
            <><button className="btn btn-ghost" onClick={()=>setEditing(false)}>Cancel</button><button className="btn btn-dark" onClick={save} disabled={saving}>{saving?'Saving…':'Save Changes'}</button></>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shipments ─────────────────────────────────────────────────────────────────
// Five base-36 characters off the millisecond clock, which is what the create form has
// always minted. Extracted because there are two callers now -- the form and the
// duplicate -- and a second inline copy would be a second thing to change.
//
// It is NOT a uniqueness guarantee: quote_number is NOT NULL with no unique constraint,
// and two forms opened in the same millisecond would produce the same value with
// nothing at any layer to catch it.
const newQuoteNumber = () => 'FQ-'+Date.now().toString(36).slice(-5).toUpperCase();

// userEmail follows Programs' precedent rather than re-reading the session: the
// shell already has it, and responded_by must record who actually answered.
function Shipments({ onNewShipment, userEmail }) {
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  // Delivery requests the client filed from the portal. Nothing in this app has
  // ever displayed them -- the table was written to by the portal and read by
  // nobody, and until 04 gave staff an RLS policy it was not even readable here.
  const [dreqs, setDreqs] = useState([]);
  const [coNames, setCoNames] = useState({});   // company id → name
  // For resolving delivery_requests.shipment_ref. See the matcher below.
  const [salesOrders, setSalesOrders] = useState([]);
  const [soPos, setSoPos] = useState([]);       // sales_order_id ↔ purchase_order_id
  const [shipPos, setShipPos] = useState([]);   // shipment_id   ↔ purchase_order_id
  const [respondId, setRespondId] = useState(null);
  const [respNote, setRespNote] = useState('');
  const [respDate, setRespDate] = useState('');
  const [respBusy, setRespBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('quotes');            // 'quotes' | 'shipments'
  const [tab, setTab] = useState('active');              // shipments sub-tab
  const [quoteFilter, setQuoteFilter] = useState('');    // '' | draft | awaiting | bidsin | awarded
  const [shipFilter, setShipFilter] = useState('');      // '' | arriving | overdue
  const [search, setSearch] = useState('');
  const [quotes, setQuotes] = useState([]);
  // null when closed, 'new' to create, or the freight quote row to edit. One state
  // rather than two, so the two paths cannot both be open at once.
  const [quoteModal, setQuoteModal] = useState(null);
  const [bids, setBids] = useState([]);
  const [rfqQuote, setRfqQuote] = useState(null);
  const [showBidImport, setShowBidImport] = useState(false);
  const [bidsQuote, setBidsQuote] = useState(null);

  const reloadBids = async () => {
    const { data } = await SB.from('forwarder_bids').select('*').order('created_at',{ascending:false});
    setBids(data||[]);
  };
  const reload = async () => {
    const { data } = await SB.from('shipments')
      .select('*,companies!client_company_id(name),shipment_pos(purchase_orders(order_number,client_po_number,client:companies!client_company_id(name)))')
      .order('created_at',{ascending:false});
    setRows(data||[]); setLoading(false);
  };
  const reloadQuotes = async () => {
    const { data } = await SB.from('shipment_quotes')
      .select('*,client:companies!client_company_id(name),forwarder:companies!forwarder_company_id(name)')
      .order('created_at',{ascending:false});
    setQuotes(data||[]);
  };
  const deleteQuote = async (id) => {
    const { error } = await SB.from('shipment_quotes').delete().eq('id',id);
    if (error) { alert('Could not delete: '+error.message); return; }
    setQuotes(prev=>prev.filter(q=>q.id!==id));
  };
  // Same shape as duplicateQuote in app/quotes.jsx: rebuild the row from the source,
  // replace the identifying field, plain insert, reload, toast.
  //
  // The number is REGENERATED rather than suffixed, unlike quotes.jsx appending
  // "-copy" to a SKU. This one is read off the card into emails to three different
  // forwarders, and FQ-UZCK0 sitting beside FQ-UZCK0-copy in that context is a mix-up
  // waiting to happen. The link back to the original is carried by the cargo, not by
  // the name.
  //
  // status resets to draft and sent_at stays null. A copy has not been sent, and
  // inheriting 'sent' would drop it straight into "Awaiting forwarder replies" for
  // replies that can never arrive -- it would also give it a sent_at from a mailing it
  // was never part of.
  //
  // forwarder_company_id is deliberately NOT carried over. Duplicating is how one
  // shipment gets quoted by three forwarders, so the forwarder is the single field the
  // copy exists to change -- prefilling it with the source's means every duplicate
  // opens holding the wrong one, and forgetting to change it sends two quotes to the
  // same forwarder under different numbers. Empty forces the one decision being made.
  // The column is nullable and the create form already allows saving without one.
  //
  // Columns are listed rather than spread from the row: the fetched object carries
  // joined client and forwarder objects, which are not columns and would be rejected,
  // and id / created_at / updated_at have to come from their defaults.
  const duplicateQuote = async (q) => {
    const { error } = await SB.from('shipment_quotes').insert({
      quote_number: newQuoteNumber(),
      client_company_id: q.client_company_id, forwarder_company_id: null,
      po_id: q.po_id,
      origin: q.origin, destination: q.destination,
      incoterm: q.incoterm, ready_date: q.ready_date,
      container_type: q.container_type, cbm_max: q.cbm_max,
      total_cartons: q.total_cartons, total_cbm: q.total_cbm, total_weight_kg: q.total_weight_kg,
      containers_needed: q.containers_needed, utilization_pct: q.utilization_pct,
      line_items: q.line_items, notes: q.notes,
      status: 'draft', sent_at: null,
    });
    if (error) { window._toast?.('Duplicate failed: '+error.message, 'err'); return; }
    await reloadQuotes();
    window._toast?.('Quote duplicated', 'ok');
  };
  // Two queries, not a join: portal.delivery_requests lives in another schema, so
  // PostgREST cannot reach vessl.companies from it. The names are fetched
  // alongside and matched in JS, the same shape Client Relations uses.
  const reloadDreqs = async () => {
    const [{ data: d }, { data: cos }, { data: sos }, { data: sop }, { data: shp }] = await Promise.all([
      SB.schema('portal').from('delivery_requests').select('*').order('created_at',{ascending:false}),
      SB.from('companies').select('id,name'),
      // The portal writes the SALES ORDER number into shipment_ref -- proven by
      // the first live request on 28 Aug. So sales orders have to be loaded to
      // resolve one at all.
      SB.from('sales_orders').select('id,so_number,order_number,status,order_date,client_company_id'),
      // The two link tables that carry a sales order to its shipments. Tiny --
      // 66 and 26 rows -- and they are the same chain portal.order_logistics
      // walks, so a request matched here is matched the way the portal thinks
      // about it.
      SB.from('sales_order_pos').select('sales_order_id,purchase_order_id'),
      SB.from('shipment_pos').select('shipment_id,purchase_order_id'),
    ]);
    const m = {}; (cos||[]).forEach(c => { m[c.id] = c.name; });
    setDreqs(d||[]); setCoNames(m);
    setSalesOrders(sos||[]); setSoPos(sop||[]); setShipPos(shp||[]);
  };

  // ┌───────────────────────────────────────────────────────────────────────────┐
  // │ RESPONDING WRITES FOUR COLUMNS TOGETHER, OR NONE.                         │
  // │                                                                           │
  // │ status, kui_response_note, responded_at and responded_by move in one       │
  // │ update. Before this table had responded_at/responded_by a request could    │
  // │ change state with no record of who did it or when -- and TWO people are    │
  // │ emailed about every request, so both could reasonably think the other      │
  // │ handled it.                                                                │
  // │                                                                           │
  // │ requested_date is never touched. 'adjusted' means we countered, and the    │
  // │ counter goes in proposed_date: overwriting what the client asked for       │
  // │ destroys the thing being negotiated.                                       │
  // └───────────────────────────────────────────────────────────────────────────┘
  const respond = async (req, status) => {
    if (respBusy) return;
    if (status === 'adjusted' && !respDate) return;   // guarded in the UI too
    setRespBusy(true);
    const patch = {
      status,
      kui_response_note: respNote.trim() || null,
      responded_at: new Date().toISOString(),
      responded_by: userEmail || null,
    };
    if (status === 'adjusted') patch.proposed_date = respDate;
    const { error } = await SB.schema('portal').from('delivery_requests').update(patch).eq('id', req.id);
    if (error) { window._toast?.('Could not save: '+error.message, 'err'); setRespBusy(false); return; }
    await reloadDreqs();
    setRespondId(null); setRespNote(''); setRespDate('');
    window._toast?.('Delivery request '+status, 'ok');
    setRespBusy(false);
  };

  useEffect(()=>{ reload(); reloadQuotes(); reloadBids(); reloadDreqs(); },[]);

  // ── derived ──
  // ┌───────────────────────────────────────────────────────────────────────────┐
  // │ shipment_ref IS FREE TEXT, AND THE PORTAL PUTS A SALES ORDER IN IT.       │
  // │                                                                           │
  // │ Despite the column's name. Proven by the first live request on 28 Aug: it  │
  // │ arrived carrying ZZTEST-SO-001, a sales_orders.so_number. The portal is    │
  // │ code we cannot read, and portal.orders exposes so_number as               │
  // │ COALESCE(so_number, order_number), so BOTH are indexed here.               │
  // │                                                                           │
  // │ BOTH, NEVER INSTEAD. Sales order first because that is the behaviour we    │
  // │ have evidence for; shipment number second because the column is named for  │
  // │ it and an unreachable writer may yet produce one. Switching to so_number   │
  // │ alone would rebuild this same bug facing the other way.                    │
  // │                                                                           │
  // │ Still allowed to miss. A ref matching neither keeps the unmatched chip:    │
  // │ a client asked us for something, and dropping the row because our join     │
  // │ failed loses the request, not the mismatch.                                │
  // └───────────────────────────────────────────────────────────────────────────┘
  const shipByNumber = useMemo(() => {
    const m = {};
    (rows||[]).forEach(s => { if (s.shipment_number) m[String(s.shipment_number).trim()] = s; });
    return m;
  }, [rows]);

  // so_number AND order_number, because portal.orders coalesces them and we do
  // not know which one a given order actually carries.
  const soByNumber = useMemo(() => {
    const m = {};
    (salesOrders||[]).forEach(so => {
      [so.so_number, so.order_number].forEach(n => { if (n) m[String(n).trim()] = so; });
    });
    return m;
  }, [salesOrders]);

  // sales_order_id → the shipments carrying it, walked SO → PO → shipment.
  const shipsForSo = useMemo(() => {
    const poByShip = {};
    (shipPos||[]).forEach(x => {
      if (!x.purchase_order_id) return;
      (poByShip[x.purchase_order_id] = poByShip[x.purchase_order_id] || []).push(x.shipment_id);
    });
    const byId = {};
    (rows||[]).forEach(s => { byId[s.id] = s; });
    const out = {};
    (soPos||[]).forEach(x => {
      (poByShip[x.purchase_order_id] || []).forEach(sid => {
        const s = byId[sid];
        if (!s) return;
        const list = out[x.sales_order_id] = out[x.sales_order_id] || [];
        if (!list.some(e => e.id === s.id)) list.push(s);
      });
    });
    return out;
  }, [soPos, shipPos, rows]);

  // Returns what the ref resolved to and HOW, so the card can say which.
  const matchRef = (ref) => {
    if (!ref) return null;
    const key = String(ref).trim();
    const so = soByNumber[key];
    if (so) return { via:'so', so, ships: shipsForSo[so.id] || [] };
    const ship = shipByNumber[key];
    if (ship) return { via:'shipment', ship, ships:[ship] };
    return null;
  };
  // 'requested' is the only state needing action -- everything else has been
  // answered or withdrawn. This is the number on the toggle pill and the nav badge.
  const openDreqs = dreqs.filter(d => (d.status||'requested') === 'requested');

  const bidCount = id => bids.filter(b=>b.shipment_quote_id===id).length;
  const winnerOf = id => bids.find(b=>b.shipment_quote_id===id && b.selected);
  const TERMINAL = ['delivered','cancelled'];
  const activeShips = rows.filter(s => !TERMINAL.includes((s.status||'').toLowerCase()) && !s.actual_arrival);
  const doneShips = rows.filter(s => TERMINAL.includes((s.status||'').toLowerCase()) || s.actual_arrival);
  const arriving = activeShips.filter(s => { const d=etaDays(s.estimated_arrival); return d!==null && d>=0 && d<=14; });
  const overdueShips = activeShips.filter(s => { const d=etaDays(s.estimated_arrival); return d!==null && d<0; });
  const awaiting = quotes.filter(q => q.status==='sent' && bidCount(q.id)===0);
  const bidsIn = quotes.filter(q => bidCount(q.id)>0 && !winnerOf(q.id));
  const awarded = quotes.filter(q => !!winnerOf(q.id));
  const drafts = quotes.filter(q => q.status!=='sent');

  const progressOf = (st) => {
    const map = { created:0.06, at_origin_port:0.18, in_transit:0.5, at_transshipment:0.6, at_destination_port:0.82, customs:0.9, out_for_delivery:0.96, delivered:1 };
    return map[st] ?? 0.1;
  };
  const legLabel = (st) => (st||'').replace(/_/g,' ');
  const fd = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
  const money0 = v => '$'+Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
  const reopen = (q) => openFreightSheet(q, (q.client||{}).name||'', (q.forwarder||{}).name||'');

  // ── filtering ──
  const norm = t => (t||'').toLowerCase();
  const matchQ = (q) => {
    if (search) {
      const hay = norm(q.quote_number)+' '+norm((q.client||{}).name)+' '+norm(q.origin)+' '+norm(q.destination)+' '+norm((winnerOf(q.id)||{}).forwarder_name);
      if (!hay.includes(norm(search))) return false;
    }
    if (quoteFilter==='draft') return q.status!=='sent';
    if (quoteFilter==='awaiting') return q.status==='sent' && bidCount(q.id)===0;
    if (quoteFilter==='bidsin') return bidCount(q.id)>0 && !winnerOf(q.id);
    if (quoteFilter==='awarded') return !!winnerOf(q.id);
    return true;
  };
  const shownQuotes = quotes.filter(matchQ);
  const matchS = (sp) => {
    if (search) {
      const po = ((sp.shipment_pos||[])[0]||{}).purchase_orders||{};
      const hay = norm(sp.shipment_number)+' '+norm(po.client_po_number)+' '+norm(po.order_number)+' '+norm((po.client||{}).name)+' '+norm((sp.companies||{}).name)+' '+norm(sp.vessel_name)+' '+norm(sp.container_no);
      if (!hay.includes(norm(search))) return false;
    }
    if (shipFilter==='arriving') { const d=etaDays(sp.estimated_arrival); if(!(d!==null&&d>=0&&d<=14&&!sp.actual_arrival)) return false; }
    if (shipFilter==='overdue') { const d=etaDays(sp.estimated_arrival); if(!(d!==null&&d<0&&!sp.actual_arrival)) return false; }
    return true;
  };
  const baseShips = tab==='active' ? activeShips : tab==='delivered' ? doneShips : rows;
  const shownShips = baseShips.filter(matchS);

  // pulse tile helper
  const pulse = [
    { k:'In transit',    v:activeShips.length,  c:'#1D1D1F', go:()=>{ setView('shipments'); setTab('active'); setShipFilter(''); } , on: view==='shipments'&&shipFilter===''&&tab==='active' },
    { k:'Arriving \u226414d', v:arriving.length, c:'#0A84FF', go:()=>{ setView('shipments'); setTab('active'); setShipFilter(shipFilter==='arriving'?'':'arriving'); }, on: view==='shipments'&&shipFilter==='arriving' },
    { k:'Overdue',       v:overdueShips.length, c:'#FF375F', go:()=>{ setView('shipments'); setTab('active'); setShipFilter(shipFilter==='overdue'?'':'overdue'); }, on: view==='shipments'&&shipFilter==='overdue' },
    { k:'Awaiting bids', v:awaiting.length,     c:'#FF9F0A', go:()=>{ setView('quotes'); setQuoteFilter(quoteFilter==='awaiting'?'':'awaiting'); }, on: view==='quotes'&&quoteFilter==='awaiting' },
    { k:'Bids in',       v:bidsIn.length,       c:'#30D158', go:()=>{ setView('quotes'); setQuoteFilter(quoteFilter==='bidsin'?'':'bidsin'); }, on: view==='quotes'&&quoteFilter==='bidsin' },
    { k:'Awarded',       v:awarded.length,      c:'#0A84FF', go:()=>{ setView('quotes'); setQuoteFilter(quoteFilter==='awarded'?'':'awarded'); }, on: view==='quotes'&&quoteFilter==='awarded' },
  ];

  return (
    <div className="db-apple" style={{padding:'30px 28px 80px',background:'#F5F5F7',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>

      {/* ── Header ── */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'16px',marginBottom:'22px',flexWrap:'wrap'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#0A84FF'}}/><span style={{fontSize:'11px',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'#86868B'}}>Freight &amp; Logistics</span></div>
          <div style={{fontSize:'32px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.032em',lineHeight:1.02}}>Shipments</div>
          <div style={{fontSize:'14.5px',color:'#86868B',marginTop:'7px',letterSpacing:'-.01em'}}>{String(quotes.length)+' quotes \u00b7 '+String(activeShips.length)+' in motion'}</div>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button onClick={()=>setQuoteModal('new')} style={{background:'#fff',color:'#1D1D1F',border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'9px 17px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Freight Quote</button>
          {onNewShipment && <button onClick={onNewShipment} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ New Shipment</button>}
        </div>
      </div>

      {/* ── Pulse strip ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'12px',marginBottom:'22px'}}>
        {pulse.map(m=>(
          <button key={m.k} onClick={m.go} style={{background:m.on?'#1D1D1F':'#fff',borderRadius:'16px',padding:'14px 16px',border:'none',boxShadow:'0 1px 3px rgba(0,0,0,.04)',cursor:'pointer',textAlign:'left',transition:'.15s'}}>
            <div style={{fontSize:'24px',fontWeight:600,letterSpacing:'-.02em',lineHeight:1,color:m.on?'#fff':(m.v>0?m.c:'#1D1D1F'),fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
            <div style={{fontSize:'11.5px',color:m.on?'rgba(255,255,255,.65)':'#86868B',marginTop:'5px',letterSpacing:'-.006em'}}>{m.k}</div>
          </button>
        ))}
      </div>

      {/* ── Controls row: segmented + search ── */}
      <div style={{display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap',marginBottom:'18px'}}>
        <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px',boxShadow:'inset 0 1px 2px rgba(0,0,0,.05)'}}>
          {/* The pill counts OPEN requests, not all of them -- consistent with
              the other two counting what is live rather than what exists, and it
              is the number that should make somebody click. */}
          {[['quotes','Freight Quotes',quotes.length],['shipments','Shipments',rows.length],['delivery','Delivery Requests',openDreqs.length]].map(([v,l,ct])=>(
            <button key={v} onClick={()=>{setView(v); setSearch('');}} style={{display:'inline-flex',alignItems:'center',gap:'8px',padding:'9px 18px',borderRadius:'9px',border:'none',cursor:'pointer',fontSize:'13.5px',fontWeight:600,letterSpacing:'-.01em',background:view===v?'#1D1D1F':'transparent',color:view===v?'#fff':'#5A5A5E',boxShadow:view===v?'0 1px 3px rgba(0,0,0,.18)':'none',transition:'.14s'}}>
              {l}<span style={{fontSize:'11px',fontWeight:700,borderRadius:'20px',padding:'1px 8px',background:view===v?'rgba(255,255,255,.22)':'#DCDCE0',color:view===v?'#fff':'#6A6A6E'}}>{ct}</span>
            </button>
          ))}
        </div>
        <div style={{position:'relative',flex:'1 1 220px',maxWidth:'340px'}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="2" strokeLinecap="round" style={{position:'absolute',left:'13px',top:'50%',transform:'translateY(-50%)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={view==='quotes'?'Search quotes, clients, routes\u2026':'Search shipments, vessels, refs\u2026'} style={{width:'100%',border:'none',borderRadius:'980px',padding:'10px 15px 10px 38px',fontSize:'13.5px',outline:'none',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.05)',boxSizing:'border-box'}} />
        </div>
        {view==='quotes' && (
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {[['','All',quotes.length],['draft','Draft',drafts.length],['awaiting','Awaiting',awaiting.length],['bidsin','Bids in',bidsIn.length],['awarded','Awarded',awarded.length]].map(([v,l,ct])=>(
              <button key={v||'all'} onClick={()=>setQuoteFilter(v)} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 13px',border:'none',cursor:'pointer',background:quoteFilter===v?'#1D1D1F':'#fff',color:quoteFilter===v?'#fff':'#5A5A5E',boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>{l+' '+String(ct)}</button>
            ))}
            <button onClick={()=>setShowBidImport(true)} style={{display:'inline-flex',alignItems:'center',gap:'6px',fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 13px',border:'1px dashed rgba(0,0,0,.18)',cursor:'pointer',background:'transparent',color:'#4A4A4E'}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>
              Import reply
            </button>
          </div>
        )}
        {view==='shipments' && (
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {[['active','In transit',activeShips.length],['delivered','Delivered',doneShips.length],['all','All',rows.length]].map(([val,label,ct])=>(
              <button key={val} onClick={()=>{setTab(val); setShipFilter('');}} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 13px',border:'none',cursor:'pointer',background:tab===val&&!shipFilter?'#1D1D1F':'#fff',color:tab===val&&!shipFilter?'#fff':'#5A5A5E',boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>{label+' '+String(ct)}</button>
            ))}
            {shipFilter && <button onClick={()=>setShipFilter('')} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 13px',border:'none',cursor:'pointer',background:'#1D1D1F',color:'#fff'}}>{(shipFilter==='arriving'?'Arriving \u226414d':'Overdue')+' \u00d7'}</button>}
          </div>
        )}
      </div>

      {/* ══ FREIGHT QUOTES — card grid ══ */}
      {view==='quotes' && (
        shownQuotes.length===0 ? (
          <div style={{background:'#fff',borderRadius:'20px',padding:'64px 32px',textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
            <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',marginBottom:'8px',letterSpacing:'-.018em'}}>{quotes.length===0?'No freight quotes yet':'Nothing matches'}</div>
            <div style={{color:'#86868B',fontSize:'14px',maxWidth:'420px',margin:'0 auto',lineHeight:1.6}}>{quotes.length===0?'Create a freight quote to spec the cargo, then RFQ it to your forwarders.':'Try clearing the search or filter.'}</div>
          </div>
        ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(330px,1fr))',gap:'14px'}}>
          {shownQuotes.map(q=>{
            const pcs = (q.line_items||[]).reduce((a,l)=>a+(Number(l.pieces)||0),0);
            const w = winnerOf(q.id); const bc = bidCount(q.id);
            const eff = w ? bidEffective(w, q.container_type||'40HQ') : 0;
            const ct = Math.max(1, Number(q.containers_needed)||1);
            return (
              <div key={q.id} style={{background:'#fff',borderRadius:'18px',padding:'18px 19px 14px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',display:'flex',flexDirection:'column',gap:'12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px'}}>
                  <span style={{fontFamily:'var(--mono)',fontSize:'13px',fontWeight:700,color:'#1D1D1F'}}>{q.quote_number}</span>
                  <span style={{fontSize:'10.5px',fontWeight:700,borderRadius:'980px',padding:'3px 10px',color:q.status==='sent'?'#0A84FF':'#B45309',background:q.status==='sent'?'#EAF3FE':'#FEF3C7',textTransform:'uppercase',letterSpacing:'.04em'}}>{q.status==='sent'?'Sent':'Draft'}</span>
                </div>
                <div>
                  <div style={{fontSize:'15px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.014em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(q.client||{}).name||'\u2014'}</div>
                  <div style={{fontSize:'12.5px',color:'#86868B',marginTop:'3px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(q.origin||'\u2014')+' \u2192 '+(q.destination||'\u2014')+' \u00b7 '+fd(q.created_at)}</div>
                </div>
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'11.5px',fontWeight:600,color:'#1D1D1F',background:'#F5F5F7',borderRadius:'7px',padding:'3px 9px'}}>{String(q.containers_needed||0)+' \u00d7 '+(q.container_type||"40'HQ")}</span>
                  {pcs>0 && <span style={{fontSize:'11.5px',fontWeight:500,color:'#5A5A5E',background:'#F5F5F7',borderRadius:'7px',padding:'3px 9px'}}>{pcs.toLocaleString()+' pcs'}</span>}
                  <span style={{fontSize:'11.5px',fontWeight:500,color:'#5A5A5E',background:'#F5F5F7',borderRadius:'7px',padding:'3px 9px'}}>{Number(q.total_cbm||0).toFixed(1)+' CBM'}</span>
                </div>
                {/* bids band */}
                <button onClick={()=>setBidsQuote(q)} style={{textAlign:'left',border:'none',cursor:'pointer',borderRadius:'12px',padding:'11px 13px',background:w?'#EAF3FE':bc>0?'#F0FDF4':'#F5F5F7'}}>
                  {w ? (
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                      <span style={{fontSize:'12.5px',fontWeight:700,color:'#0A84FF',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{'\u2713 '+(w.forwarder_name||'Selected')}</span>
                      <span style={{fontSize:'12.5px',fontWeight:800,color:'#1D1D1F',fontVariantNumeric:'tabular-nums',flexShrink:0}}>{money0(eff)}<span style={{fontSize:'10px',fontWeight:600,color:'#86868B'}}>/ctr</span></span>
                    </div>
                  ) : bc>0 ? (
                    <span style={{fontSize:'12.5px',fontWeight:700,color:'#15803D'}}>{String(bc)+' bid'+(bc===1?'':'s')+' in \u2014 compare & select'}</span>
                  ) : q.status==='sent' ? (
                    <span style={{fontSize:'12.5px',fontWeight:600,color:'#86868B'}}>Awaiting forwarder replies…</span>
                  ) : (
                    <span style={{fontSize:'12.5px',fontWeight:600,color:'#86868B'}}>Not sent yet — RFQ it below</span>
                  )}
                  {w && <div style={{fontSize:'11px',color:'#5A5A5E',marginTop:'3px'}}>{'\u2248 '+money0(eff*ct)+' shipment total'+(w.transit_days?' \u00b7 '+w.transit_days+'d transit':'')}</div>}
                </button>
                {/* actions */}
                <div style={{display:'flex',gap:'6px',alignItems:'center',borderTop:'1px solid rgba(0,0,0,.05)',paddingTop:'11px'}}>
                  <button onClick={()=>setRfqQuote(q)} style={{display:'inline-flex',alignItems:'center',gap:'5px',background:'#0A84FF',border:'none',borderRadius:'980px',padding:'7px 14px',fontSize:'12px',fontWeight:600,color:'#fff',cursor:'pointer'}}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                    RFQ
                  </button>
                  <button onClick={()=>setQuoteModal(q)} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'7px 14px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer'}}>Edit</button>
                  <button onClick={()=>reopen(q)} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'7px 14px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer'}}>Sheet</button>
                  <div style={{flex:1}} />
                  {/* lucide's Copy glyph, drawn inline rather than imported. page.jsx
                      imports no icon library and uses inline SVG throughout -- the same
                      call the eFiling clear button made. The path is lucide's own, so it
                      is the identical icon to the Duplicate control on the Quotes page. */}
                  <button title="Duplicate" aria-label={'Duplicate freight quote '+(q.quote_number||'')} onClick={()=>duplicateQuote(q)} style={{background:'none',border:'none',cursor:'pointer',padding:'5px',borderRadius:'7px',color:'#C7C7CC',display:'flex'}} onMouseEnter={e=>{e.currentTarget.style.color='#1D1D1F';}} onMouseLeave={e=>{e.currentTarget.style.color='#C7C7CC';}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  </button>
                  <button title="Delete quote" onClick={()=>{ if(window.confirm('Delete freight quote '+q.quote_number+'? This cannot be undone.')) deleteQuote(q.id); }} style={{background:'none',border:'none',cursor:'pointer',padding:'5px',borderRadius:'7px',color:'#C7C7CC',display:'flex'}} onMouseEnter={e=>{e.currentTarget.style.color='#FF375F';}} onMouseLeave={e=>{e.currentTarget.style.color='#C7C7CC';}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        )
      )}

      {/* ══ DELIVERY REQUESTS — what the client asked for, and our answer ══ */}
      {view==='delivery' && (
        dreqs.length===0 ? (
          <div style={{padding:'60px',textAlign:'center',color:'#86868B',fontSize:'14px'}}>
            <div style={{fontSize:32,marginBottom:12,opacity:.2}}>📅</div>
            <div style={{fontWeight:600,color:'#5A5A5E',marginBottom:6,fontSize:15}}>No delivery requests</div>
            <div style={{fontSize:13}}>Clients file these from the portal against a shipment on one of their orders.</div>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
            {dreqs.map(d => {
              const st = d.status || 'requested';
              const hit = matchRef(d.shipment_ref);
              // The shipment to describe: the one the ref named, or the first one
              // carrying the sales order it named. A sales order with no shipment
              // yet still MATCHES -- the client can ask for a delivery date before
              // anything has sailed, and that is not an unmatched reference.
              const ship = hit ? (hit.ships[0] || null) : null;
              const open = st === 'requested';
              const responding = respondId === d.id;
              const tone = st==='confirmed' ? ['#15803D','#DCFCE7']
                         : st==='adjusted'  ? ['#B45309','#FEF3C7']
                         : st==='declined'  ? ['#B91C1C','#FEE2E2']
                         : st==='cancelled' ? ['#5A5A5E','#F2F2F4']
                         :                    ['#1D4ED8','#DBEAFE'];
              return (
                <div key={d.id} style={{background:'#fff',borderRadius:'14px',padding:'16px 18px',boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
                    <div style={{flex:'1 1 260px',minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                        <span style={{fontSize:'14px',fontWeight:700,color:'#1A1A1C'}}>{d.shipment_ref}</span>
                        {/* SAYS SO RATHER THAN HIDING IT. shipment_ref is free text
                            written by the portal; if it matches neither a sales
                            order nor a shipment the request is still real and
                            still needs answering.
                            Naming HOW it matched is deliberate -- "sales order"
                            vs a bare shipment status is the difference between
                            reading this card and trusting it. */}
                        {hit
                          ? <span style={{fontSize:'11.5px',color:'#8A8A8E'}}>
                              {hit.via==='so' ? 'sales order' : 'shipment'}
                              {ship ? ' · '+(ship.status||'').replace(/_/g,' ') : ''}
                              {ship && ship.container_no ? ' · '+ship.container_no : ''}
                              {hit.via==='so' && !ship ? ' · no shipment yet' : ''}
                              {hit.via==='so' && hit.ships.length>1 ? ' · +'+(hit.ships.length-1)+' more' : ''}
                            </span>
                          : <span title="Matches no sales order number and no shipment number" style={{fontSize:'11px',fontWeight:600,borderRadius:'20px',padding:'2px 8px',background:'#F2F2F4',color:'#8A8A8E'}}>unmatched ref</span>}
                        <span style={{fontSize:'11px',fontWeight:700,borderRadius:'20px',padding:'2px 9px',textTransform:'uppercase',letterSpacing:'.03em',color:tone[0],background:tone[1]}}>{st}</span>
                      </div>
                      <div style={{fontSize:'12.5px',color:'#5A5A5E',marginTop:'5px',lineHeight:1.6}}>
                        {coNames[d.client_company_id]||'Unknown client'}
                        {d.container_no ? ' · container '+d.container_no : ''}
                        <br/>
                        Requested <b style={{color:'#1A1A1C'}}>{fmtDate(d.requested_date)}</b>
                        {d.eta ? ' · ETA '+fmtDate(d.eta) : ''}
                        {d.requested_by ? ' · by '+d.requested_by : ''}
                        {/* The counter-offer sits BESIDE the ask, never over it. */}
                        {d.proposed_date ? <><br/>We proposed <b style={{color:'#1A1A1C'}}>{fmtDate(d.proposed_date)}</b></> : null}
                      </div>
                      {d.note && <div style={{fontSize:'12.5px',color:'#4A4A4E',marginTop:'8px',background:'#FAFAFA',borderRadius:'8px',padding:'8px 10px',lineHeight:1.5}}>{d.note}</div>}
                      {d.kui_response_note && <div style={{fontSize:'12.5px',color:'#4A4A4E',marginTop:'6px',borderLeft:'3px solid #DCDCE0',paddingLeft:'9px',lineHeight:1.5}}><b>Our reply:</b> {d.kui_response_note}</div>}
                      {d.responded_at && <div style={{fontSize:'11px',color:'#A0A0A4',marginTop:'6px'}}>Answered {fmtDateTime(d.responded_at)}{d.responded_by?' by '+d.responded_by:''}</div>}
                    </div>
                    {open && !responding && (
                      <button onClick={()=>{setRespondId(d.id);setRespNote('');setRespDate('');}} className="btn btn-dark" style={{fontSize:'12.5px',padding:'7px 14px'}}>Respond</button>
                    )}
                  </div>

                  {responding && (
                    <div style={{marginTop:'14px',borderTop:'1px solid #F0F0F2',paddingTop:'13px'}}>
                      <div style={{display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'flex-end'}}>
                        <div style={{flex:'1 1 260px'}}>
                          <label style={{fontSize:'11px',fontWeight:600,color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.04em'}}>Reply to the client</label>
                          <textarea className="form-input" rows={2} value={respNote} onChange={e=>setRespNote(e.target.value)} placeholder="Optional — goes back to them in the portal" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5,marginTop:'4px'}} />
                        </div>
                        <div style={{flex:'0 0 165px'}}>
                          <label style={{fontSize:'11px',fontWeight:600,color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.04em'}}>Date we propose</label>
                          <input type="date" className="form-input" value={respDate} onChange={e=>setRespDate(e.target.value)} style={{marginTop:'4px'}} />
                        </div>
                      </div>
                      <div style={{display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap',alignItems:'center'}}>
                        <button disabled={respBusy} onClick={()=>respond(d,'confirmed')} className="btn btn-dark" style={{fontSize:'12.5px',padding:'7px 14px'}}>Confirm {fmtDate(d.requested_date)}</button>
                        {/* Adjust is the only action with a prerequisite: without a
                            date it would claim we countered and say nothing with
                            what, so it stays disabled rather than silently writing
                            'adjusted' with a null proposed_date. */}
                        <button disabled={respBusy||!respDate} title={respDate?'':'Pick the date you are proposing'} onClick={()=>respond(d,'adjusted')} className="btn btn-ghost" style={{fontSize:'12.5px',padding:'7px 14px',opacity:respDate?1:.45}}>Adjust</button>
                        <button disabled={respBusy} onClick={()=>respond(d,'declined')} className="btn btn-ghost" style={{fontSize:'12.5px',padding:'7px 14px',color:'#B91C1C'}}>Decline</button>
                        <button disabled={respBusy} onClick={()=>{setRespondId(null);setRespNote('');setRespDate('');}} style={{background:'none',border:'none',cursor:'pointer',color:'#8A8A8E',fontSize:'12.5px',fontWeight:600}}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ══ SHIPMENTS — voyage manifest ══ */}
      {view==='shipments' && (
        loading ? <div style={{padding:'60px',textAlign:'center',color:'#86868B',fontSize:'14px'}}>Loading…</div>
        : shownShips.length ? (
        <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
          <div className="ship-manifest-head" style={{display:'grid',gridTemplateColumns:'150px 1fr 128px 96px',gap:'18px',padding:'13px 22px',borderBottom:'1px solid rgba(0,0,0,.06)',background:'#FAFAFB'}}>
            <div style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4'}}>Reference</div>
            <div style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4'}}>Voyage</div>
            <div style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',textAlign:'right'}}>ETD / ETA</div>
            <div style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',textAlign:'right'}}>Arrival</div>
          </div>
          {shownShips.map((s,i)=>{
            const po = ((s.shipment_pos||[])[0]||{}).purchase_orders;
            const ref = (po||{}).client_po_number || (po||{}).order_number || s.shipment_number || '\u2014';
            const clientName = (((po||{}).client||{}).name || (s.companies||{}).name || '\u2014').toUpperCase();
            const days = s.actual_arrival ? null : etaDays(s.estimated_arrival);
            const overdue = days!==null && days<0;
            const delivered = (s.status==='delivered' || s.actual_arrival);
            const frac = delivered ? 1 : progressOf(s.status);
            return (
              <div key={s.id} onClick={()=>setOpenId(s.id)} className="ship-manifest-row" style={{display:'grid',gridTemplateColumns:'150px 1fr 128px 96px',gap:'18px',padding:'16px 22px',borderTop:i>0?'1px solid #F5F5F7':'none',cursor:'pointer',transition:'.12s',alignItems:'center'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:'var(--mono)',fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ref}</div>
                <div style={{fontSize:'11px',color:'#86868B',marginTop:'3px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{clientName}</div>
              </div>
              <div style={{minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={overdue?'#FF375F':'#6B7280'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18h18l-2-6H5l-2 6z"/><path d="M12 12V4M8 8h8"/></svg>
                  <span style={{fontSize:'12.5px',fontWeight:500,color:'#3A3A3E',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.vessel_name||'Vessel TBD'}{s.voyage_no?' \u00b7 '+s.voyage_no:''}</span>
                  {s.container_no && <span style={{fontFamily:'var(--mono)',fontSize:'10.5px',color:'#A0A0A4',whiteSpace:'nowrap'}}>{s.container_no}</span>}
                </div>
                <div style={{position:'relative',height:'3px',background:'#ECECEE',borderRadius:'2px'}}>
                  <div style={{position:'absolute',left:0,top:0,height:'100%',width:(frac*100)+'%',background:overdue?'#FF375F':delivered?'#30D158':'#0A84FF',borderRadius:'2px',transition:'width .4s'}} />
                  <div style={{position:'absolute',top:'50%',left:(frac*100)+'%',width:'9px',height:'9px',borderRadius:'50%',background:overdue?'#FF375F':delivered?'#30D158':'#0A84FF',transform:'translate(-50%,-50%)',border:'2px solid #fff',boxShadow:'0 1px 2px rgba(0,0,0,.2)'}} />
                </div>
                <div style={{fontSize:'10px',color:'#A0A0A4',marginTop:'6px',textTransform:'uppercase',letterSpacing:'.05em'}}>{legLabel(s.status)}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:'12px',color:'#86868B',fontVariantNumeric:'tabular-nums'}}><span style={{color:'#C7C7CC'}}>ETD</span> {fmtDateShort(s.estimated_departure)}</div>
                <div style={{fontSize:'13px',fontWeight:600,color:'#1D1D1F',marginTop:'2px',fontVariantNumeric:'tabular-nums'}}><span style={{color:'#C7C7CC',fontWeight:400}}>ETA</span> {fmtDateShort(s.estimated_arrival)}</div>
              </div>
              <div style={{textAlign:'right'}}>
                {delivered ? (
                  <span style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'12px',fontWeight:600,color:'#30D158'}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Delivered
                  </span>
                ) : days!==null ? (
                  <>
                    <div style={{fontSize:'16px',fontWeight:700,color:overdue?'#FF375F':'#1D1D1F',fontVariantNumeric:'tabular-nums',lineHeight:1}}>{overdue?'+'+Math.abs(days):days}<span style={{fontSize:'11px',color:'#A0A0A4',fontWeight:400}}>d</span></div>
                    <div style={{fontSize:'9.5px',color:overdue?'#FF375F':'#A0A0A4',marginTop:'2px'}}>{overdue?'overdue':'to ETA'}</div>
                  </>
                ) : <span style={{fontSize:'12px',color:'#C7C7CC'}}>—</span>}
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <div style={{background:'#fff',borderRadius:'20px',padding:'64px 32px',textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',marginBottom:'8px',letterSpacing:'-.018em'}}>{rows.length===0?'No shipments yet':'Nothing matches'}</div>
          <div style={{color:'#86868B',fontSize:'14px',maxWidth:'420px',margin:'0 auto',lineHeight:1.6}}>{rows.length===0?'Shipments appear here when orders move to the shipping stage.':'Try clearing the search or filter.'}</div>
        </div>
      ))}

      {openId && <ShipmentDetailModal id={openId} onClose={()=>setOpenId(null)} onSaved={()=>{setOpenId(null);reload();}} />}
      {quoteModal && <ShipmentQuoteModal data={quoteModal==='new'?null:quoteModal} onClose={()=>setQuoteModal(null)} onSaved={()=>{setQuoteModal(null);reloadQuotes();}} />}
      {rfqQuote && <ForwarderRFQModal quote={rfqQuote} onClose={()=>setRfqQuote(null)} onSent={()=>{setRfqQuote(null); reloadQuotes();}} />}
      {showBidImport && <ImportBidsModal quotes={quotes} onClose={()=>setShowBidImport(false)} onApplied={()=>{setShowBidImport(false); reloadBids();}} />}
      {bidsQuote && <BidsCompareModal quote={bidsQuote} bids={bids.filter(b=>b.shipment_quote_id===bidsQuote.id)} onClose={()=>setBidsQuote(null)} onDeleted={reloadBids} />}
    </div>
  );
}

// ── Forwarder RFQ loop ────────────────────────────────────────────────────────
function loadExcelJS() {
  return new Promise(function(resolve, reject){
    if (typeof window!=='undefined' && window.ExcelJS) { resolve(window.ExcelJS); return; }
    var el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    el.onload = function(){ resolve(window.ExcelJS); };
    el.onerror = function(){ reject(new Error('Could not load the Excel engine — check the connection and try again.')); };
    document.head.appendChild(el);
  });
}

// RFQ_* geometry now lives in lib/rfqSheet.js, imported above.

function bidEffective(b, containerType) {
  if (Number(b.effective_per_container) > 0) return Number(b.effective_per_container);
  const rates = b.rates || {};
  const r = rates[containerType] || {};
  const ocean = Number(r.ocean)||0, origin = Number(r.origin)||0;
  const dest = Number(b.dest_total)||0;
  const total = ocean + origin + dest;
  return total > 0 ? total : (Number(b.all_in_per_container)||0);
}

function ForwarderRFQModal({ quote, onClose, onSent }) {
  // markDirty on the recipient radios: the chosen contact renders as row styling
  // and a text summary, never as a control's value, so picking one is invisible to
  // the dirty guard's snapshot. The manual-email box beside them is a real input
  // and needs no help.
  const { ref: cardRef, guardedClose, markDirty } = useDirtyGuard(onClose);
  const [groups, setGroups] = useState([]);
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ THE SELECTION IS AN OBJECT, NOT AN EMAIL STRING.                        │
  // │                                                                         │
  // │ {contactId, email, companyId, name, company}. mailto only needs `email`, │
  // │ but the send API that replaces it will need the contact and company ids  │
  // │ to record what it did -- and this modal already needs companyId to write │
  // │ forwarder_company_id. Carrying the whole row means swapping the          │
  // │ transport later touches the transport only, not the picking.            │
  // │                                                                         │
  // │ A typed address has no ids, so it carries nulls and the post-send update │
  // │ writes no forwarder. That is correct: nobody can say which company an    │
  // │ arbitrary address belongs to, and guessing would attach a bid to the     │
  // │ wrong forwarder.                                                        │
  // └─────────────────────────────────────────────────────────────────────────┘
  const [pick, setPick] = useState(null);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  // CONTACTS, not companies. companies.email is null on all four forwarders, so
  // the old filter -- which tested email BEFORE type -- dropped every one of them
  // and rendered the client and factory list instead. The addresses have always
  // lived in vessl.contacts: six of them across three forwarders.
  //
  // The type test is the one the rest of this tab already uses. The old substring
  // match on 'forward'/'carrier'/'freight' was scanning for values the enum does
  // not have loose spellings of.
  useEffect(()=>{
    let alive = true;
    Promise.all([
      SB.from('companies').select('id,name,type').in('type',['carrier','freight_forwarder']).order('name'),
      SB.from('contacts').select('id,company_id,full_name,email,is_primary'),
    ]).then(([c,ct])=>{
      if (!alive) return;
      const cos = (!c.error && c.data) || [];
      const all = (!ct.error && ct.data) || [];
      setGroups(cos.map(co=>({
        ...co,
        // Primary first, then by name. A forwarder with no contact still gets a
        // group -- rendering it empty says "nobody has recorded an address here",
        // which is a fixable gap, where omitting it silently says nothing at all.
        // TQL is that case today.
        contacts: all.filter(x=>x.company_id===co.id && x.email)
                     .sort((a,b)=>(b.is_primary?1:0)-(a.is_primary?1:0) || String(a.full_name||'').localeCompare(String(b.full_name||''))),
      })));
    });
    return ()=>{ alive = false; };
  },[]);

  const choose = (co, ct) => { markDirty(); setPick({ contactId:ct.id, email:String(ct.email), companyId:co.id, name:ct.full_name||String(ct.email), company:co.name }); };
  // A typed address is a valid recipient with no identity -- see the box above.
  const useTyped = () => {
    const e = extra.trim();
    if (!e || !e.includes('@')) return;
    markDirty();
    setPick({ contactId:null, email:e, companyId:null, name:e, company:null });
  };

  // The workbook, built in the browser for the DOWNLOAD only. The attachment
  // that actually goes to a forwarder is built server-side from the stored
  // quote -- same function, same geometry module, so the two are byte-identical
  // without the client ever being trusted to produce the file that gets sent.
  const buildBuffer = async () => {
    const ExcelJS = await loadExcelJS();
    return buildRfqWorkbook(ExcelJS, quote, (quote.client||{}).name);
  };

  // ── Download sheet ─────────────────────────────────────────────────────────
  // Its own control now, and deliberately independent of sending. It used to be
  // a side effect of Generate, which meant a failed send left Kristy with no
  // file at all. It writes nothing to the quote: downloading is not sending, and
  // the status must not move because someone wanted to look at the sheet.
  const download = async () => {
    setBusy(true);
    try {
      const buf = await buildBuffer();
      const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = rfqFileName(quote); a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert('Could not build the RFQ sheet: '+(e&&e.message?e.message:e));
    }
    setBusy(false);
  };

  // ── Send ───────────────────────────────────────────────────────────────────
  const send = async () => {
    if (!pick) { alert('Pick a contact to send this RFQ to.'); return; }
    // ┌───────────────────────────────────────────────────────────────────────┐
    // │ ONE COLUMN, ONE FORWARDER -- so overwriting it has to be deliberate.  │
    // │                                                                       │
    // │ shipment_quotes.forwarder_company_id is a single uuid. A quote sent to │
    // │ two forwarders cannot be represented, which is exactly what Duplicate  │
    // │ exists for: it copies the cargo and deliberately clears the forwarder, │
    // │ so one shipment becomes one row per bidder.                           │
    // │                                                                       │
    // │ Only a DIFFERENT company prompts. Re-sending to the same one -- a      │
    // │ chased reply, a corrected sheet, a second contact at the same firm --  │
    // │ overwrites nothing, and asking would train her to click through it.    │
    // └───────────────────────────────────────────────────────────────────────┘
    const prior = quote.forwarder_company_id || null;
    if (pick.companyId && prior && prior !== pick.companyId) {
      const priorName = (groups.find(g=>g.id===prior)||{}).name || 'another forwarder';
      if (!window.confirm(
        'This quote is recorded as sent to '+priorName+'.\n\n'+
        'Sending to '+pick.company+' will replace that — a quote records one forwarder.\n\n'+
        'The Duplicate button on the quote card makes a copy per forwarder.'
      )) return;
    }
    setBusy(true);
    try {
      // The route authenticates the CALLER, not the app, so it needs this
      // session's access token. Without it every request is a stranger's and
      // the endpoint is an open relay on a verified domain.
      const { data:{ session } } = await SB.auth.getSession();
      const token = session && session.access_token;
      if (!token) { alert('Your session has expired — sign in again before sending.'); setBusy(false); return; }

      // Only the id and the recipient cross the wire. The route re-reads the
      // cargo from the database, so nothing here can decide what a forwarder
      // receives.
      const res = await fetch('/api/rfq/send', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+token },
        body: JSON.stringify({ quoteId: quote.id, contact: pick }),
      });
      let out = null;
      try { out = await res.json(); } catch { out = null; }

      if (!res.ok || !out || !out.ok || !out.id) {
        alert('The RFQ was NOT sent.\n\n'+((out && out.error) || ('The server returned '+res.status+'.'))+'\n\nThe quote is unchanged.');
        setBusy(false);
        return;
      }

      // ┌─────────────────────────────────────────────────────────────────────┐
      // │ "SENT" NOW MEANS SENT.                                              │
      // │                                                                     │
      // │ This write happens ONLY on a 200 carrying a Resend id. The old flow  │
      // │ marked the quote sent before it opened a mailto, unconditionally --  │
      // │ so six of seven rows read 'sent' while forwarder_bids holds nothing, │
      // │ and nothing on screen could tell a real send from a pressed button.  │
      // │                                                                     │
      // │ All four fields move together: the status, when, to whom, and the    │
      // │ provider id that is the evidence for the other three.                │
      // └─────────────────────────────────────────────────────────────────────┘
      const upd = { status:'sent', sent_at:new Date().toISOString(), resend_message_id: out.id };
      if (pick.companyId) upd.forwarder_company_id = pick.companyId;
      const { error: updErr } = await SB.from('shipment_quotes').update(upd).eq('id', quote.id);
      if (updErr) {
        // The mail is already gone; only a message can explain why the card
        // still reads Draft. Swallowing this would be worse than the bug fixed
        // above -- it was sent, and the record would silently disagree.
        alert('The RFQ was sent to '+out.to+', but recording it failed: '+updErr.message+'\n\nThe quote still reads as a draft.');
      } else {
        window._toast?.('RFQ sent to '+pick.name, 'ok');
      }
      onSent && onSent();
    } catch (e) {
      alert('The RFQ was NOT sent: '+(e&&e.message?e.message:e)+'\n\nThe quote is unchanged.');
    }
    setBusy(false);
  };

  return (
    <div onClick={e=>e.target===e.currentTarget&&guardedClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'36px 16px',zIndex:1100,overflowY:'auto'}}>
      <div ref={cardRef} style={{background:'#fff',borderRadius:'18px',width:'100%',maxWidth:'560px',boxShadow:'0 12px 48px rgba(0,0,0,.2)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 0'}}>
          <div style={{fontSize:'17px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.015em'}}>Request forwarder quotes</div>
          <div style={{fontSize:'13px',color:'#8A8A8E',marginTop:'4px',lineHeight:1.5}}>
            {(quote.quote_number||'')+' · '+(quote.origin||'?')+' → '+(quote.destination||'?')+' · '+String(quote.containers_needed||'?')+' × '+(quote.container_type||"40'HQ")}. Generates the fillable RFQ sheet — rates per container size, itemized destination charges, and if-needed fees — then opens the email to ONE contact. Attach the downloaded file and send.
          </div>
        </div>
        <div style={{padding:'18px 24px'}}>
          {/* ONE recipient, chosen by radio rather than toggled as chips. These
              forwarders compete for the same freight, so the multi-select this
              replaces was not a convenience -- it built a comma-joined To: that
              showed each bidder who else had been asked. Send to one, then use
              Duplicate on the card and send the copy to the next. */}
          <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'8px'}}>Send to</div>
          {groups.length === 0 && (
            <div style={{fontSize:'13px',color:'#8A8A8E',marginBottom:'14px'}}>No forwarders on file. Add one under Companies, then add a contact with an email address.</div>
          )}
          {groups.map(co=>(
            <div key={co.id} style={{marginBottom:'12px'}}>
              <div style={{fontSize:'12.5px',fontWeight:700,color:'#1A1A1C',marginBottom:'5px'}}>{co.name}</div>
              {/* A forwarder with no contact still gets its heading. Silence would
                  read as "this company does not exist"; the empty line reads as
                  "nobody has recorded an address", which is a thing to go and fix.
                  TQL is that case today. */}
              {co.contacts.length === 0 ? (
                <div style={{fontSize:'12px',color:'#B0B0B4',paddingLeft:'2px'}}>No contact on file — add one under Companies to send here.</div>
              ) : co.contacts.map(ct=>{
                const on = !!pick && pick.contactId === ct.id;
                return (
                  <label key={ct.id} style={{display:'flex',alignItems:'center',gap:'9px',padding:'7px 9px',borderRadius:'9px',cursor:'pointer',background:on?'#EAF3FE':'transparent',border:'1px solid '+(on?'#0071E3':'transparent'),margin:0,fontFamily:'inherit',fontSize:'13px',letterSpacing:0,textTransform:'none',color:'#1A1A1C'}}>
                    <input type="radio" name="rfq-contact" checked={on} onChange={()=>choose(co, ct)} style={{margin:0,cursor:'pointer'}} />
                    <span style={{minWidth:0,flex:1}}>
                      <span style={{fontWeight:600}}>{ct.full_name || String(ct.email)}</span>
                      {ct.is_primary && <span style={{fontSize:'10px',fontWeight:700,color:'#0071E3',background:'#DBEAFE',borderRadius:'5px',padding:'1px 6px',marginLeft:'7px'}}>PRIMARY</span>}
                      <span style={{display:'block',fontSize:'11.5px',color:'#8A8A8E',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{String(ct.email)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
          {/* Kept, because a one-off broker who is not in the directory is a real
              case. It carries no ids, so nothing is recorded against a company --
              see the note on `pick`. */}
          <div style={{display:'flex',gap:'6px',marginTop:'4px'}}>
            <input value={extra} onChange={e=>setExtra(e.target.value)} onKeyDown={e=>e.key==='Enter'&&useTyped()} placeholder="Or type an address…" style={{flex:1,border:'1px solid #E5E7EB',borderRadius:'9px',padding:'9px 12px',fontSize:'13px',outline:'none',boxSizing:'border-box'}} />
            <button onClick={useTyped} style={{background:'#F2F2F6',border:'none',borderRadius:'9px',padding:'9px 15px',fontSize:'13px',fontWeight:600,color:'#1A1A1C',cursor:'pointer'}}>Use</button>
          </div>
          {pick && (
            <div style={{fontSize:'12px',color:'#4A4A4E',marginTop:'12px',lineHeight:1.6}}>
              Sending to <b>{pick.name}</b>{pick.company ? ' at '+pick.company : ''} — {pick.email}
              {!pick.companyId && <span style={{color:'#B45309'}}> · not a directory contact, so no forwarder will be recorded on the quote</span>}
            </div>
          )}
        </div>
        <div style={{padding:'0 24px 20px',display:'flex',justifyContent:'flex-end',gap:'8px'}}>
          <button onClick={onClose} style={{background:'#F2F2F6',border:'none',borderRadius:'10px',padding:'9px 17px',fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',cursor:'pointer'}}>Cancel</button>
          {/* Download is SECONDARY and always available -- it neither needs a
              contact nor touches the quote. Sending is the primary action and
              stays disabled until somebody is picked. Splitting them is the
              point: a failed send used to leave no file behind, because the
              download was a side effect of the same button. */}
          <button onClick={download} disabled={busy} style={{background:'#F2F2F6',border:'none',borderRadius:'10px',padding:'9px 17px',fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',cursor:busy?'not-allowed':'pointer'}}>Download sheet</button>
          <button onClick={send} disabled={busy||!pick} style={{background:pick?'#0071E3':'#C7C7CC',color:'#fff',border:'none',borderRadius:'10px',padding:'9px 18px',fontSize:'13.5px',fontWeight:600,cursor:pick?'pointer':'not-allowed'}}>{busy?'Sending…':(pick?('Send to '+pick.name):'Send')}</button>
        </div>
      </div>
    </div>
  );
}

function ImportBidsModal({ quotes, onClose, onApplied }) {
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(0);
  // Declared AFTER `applied` because it closes over it. The backdrop already
  // chose between two exits depending on whether anything was imported; the
  // guard wraps that whole decision rather than replacing it. Choosing a file
  // changes the file input's value, so a staged import is visible to the
  // snapshot without markDirty.
  const { ref: cardRef, guardedClose } = useDirtyGuard(
    useCallback(() => { if (applied > 0) onApplied(); else onClose(); }, [applied, onApplied, onClose])
  );

  const parse = async (file) => {
    setBusy(true);
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      const val = (r,c) => { const v=ws.getRow(r).getCell(c).value; if(v==null) return ''; if(typeof v==='object'&&v.text!=null) return String(v.text); if(typeof v==='object'&&v.result!=null) return String(v.result); if(v instanceof Date) return v.toISOString().slice(0,10); return String(v); };
      const num = (r,c) => { const raw=val(r,c).replace(/[^0-9.\-]/g,''); return raw===''?null:(Number(raw)||null); };
      // RFQ_ID_ROW, never a literal: this read was val(1,2) until the title
      // band pushed the id to row 2, and a hardcoded number is invisible to any
      // change made in the geometry module.
      const rfqId = val(RFQ_ID_ROW,2).trim();
      const quote = (quotes||[]).find(q=>q.id===rfqId);
      if (!quote) { alert('This file does not match any freight quote — the RFQ ID cell (B1) is missing or was edited.'); setBusy(false); return; }

      const rates = {};
      RFQ_SIZES.forEach(function(sz){
        const ocean=num(sz.row,2), origin=num(sz.row,3), carrier=val(sz.row,4).trim(), transit=num(sz.row,5);
        if (ocean||origin||carrier||transit) rates[sz.key]={ ocean:ocean||0, origin:origin||0, carrier:carrier||'', transit:transit||null };
      });
      const dest = []; let destTotal = 0;
      for (var r=RFQ_DEST_ROWS.first; r<=RFQ_DEST_ROWS.last; r++) {
        const fee=val(r,1).trim(), amt=num(r,2), basis=val(r,3).trim();
        if (fee||amt) { dest.push({fee:fee||'Fee', amount:amt||0, basis:basis||''}); destTotal+=amt||0; }
      }
      const acc = [];
      for (var r2=RFQ_ACC_ROWS.first; r2<=RFQ_ACC_ROWS.last; r2++) {
        const fee=val(r2,1).trim(), amt=num(r2,2), basis=val(r2,3).trim();
        if (amt) acc.push({fee:fee||'Fee', amount:amt, basis:basis||''});
      }
      const primary = rates[quote.container_type||'40HQ'] || {};
      const effective = (Number(primary.ocean)||0)+(Number(primary.origin)||0)+destTotal;
      const bid = {
        shipment_quote_id: quote.id, quote_number: quote.quote_number||null,
        forwarder_name: val(RFQ_NAME_ROW,2).trim()||'Unknown forwarder',
        contact_email: val(RFQ_EMAIL_ROW,2).trim()||null,
        carrier: primary.carrier||null,
        transit_days: primary.transit||null,
        origin_costs: primary.origin||null,
        ocean_per_container: primary.ocean||null,
        dest_total: destTotal||null,
        effective_per_container: effective>0?effective:null,
        rates: Object.keys(rates).length?rates:null,
        dest_charges: dest.length?dest:null,
        accessorials: acc.length?acc:null,
        valid_until: val(RFQ_VALID_ROW,2).trim()||null,
        notes: val(RFQ_NOTES_ROW,2).trim()||null,
      };
      setParsed({ quote, bid });
    } catch (e) {
      alert('Could not read that file: '+(e&&e.message?e.message:e));
    }
    setBusy(false);
  };

  const apply = async () => {
    setBusy(true);
    const { error } = await SB.from('forwarder_bids').insert(parsed.bid);
    setBusy(false);
    if (error) { alert('Could not save the bid: '+error.message); return; }
    setApplied(a=>a+1); setParsed(null);
    if (fileRef.current) fileRef.current.value='';
  };

  const money = v => v==null||v===''?'\u2014':'$'+Number(v).toLocaleString(undefined,{maximumFractionDigits:2});

  return (
    <div onClick={e=>e.target===e.currentTarget&&guardedClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'36px 16px',zIndex:1100,overflowY:'auto'}}>
      <div ref={cardRef} style={{background:'#fff',borderRadius:'18px',width:'100%',maxWidth:'540px',boxShadow:'0 12px 48px rgba(0,0,0,.2)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 0'}}>
          <div style={{fontSize:'17px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.015em'}}>Import forwarder reply</div>
          <div style={{fontSize:'13px',color:'#8A8A8E',marginTop:'4px',lineHeight:1.5}}>Upload the RFQ sheet a forwarder sent back. It matches the freight quote automatically, totals the destination charges, and lands as a comparable bid.{applied>0?' '+String(applied)+' imported this session.':''}</div>
        </div>
        <div style={{padding:'18px 24px'}}>
          {!parsed ? (
            <button onClick={()=>fileRef.current&&fileRef.current.click()} disabled={busy} style={{width:'100%',border:'1.5px dashed rgba(0,0,0,.15)',background:'#FAFAFA',borderRadius:'14px',padding:'34px 16px',fontSize:'13.5px',color:'#5A5A5E',cursor:'pointer'}}>
              {busy?'Reading\u2026':'Tap to choose the returned .xlsx file'}
            </button>
          ) : (
            <div>
              <div style={{fontSize:'14px',fontWeight:700,color:'#1A1A1C'}}>{parsed.bid.forwarder_name}{parsed.bid.carrier?' \u00b7 '+parsed.bid.carrier:''}</div>
              <div style={{fontSize:'12px',color:'#8A8A8E',marginBottom:'12px'}}>{'for '+(parsed.quote.quote_number||'')+' \u00b7 '+(parsed.quote.origin||'?')+' \u2192 '+(parsed.quote.destination||'?')}</div>
              {parsed.bid.rates && Object.keys(parsed.bid.rates).map(function(k){
                const r = parsed.bid.rates[k]; const req = k===(parsed.quote.container_type||'40HQ');
                return (
                  <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:'12.5px',borderTop:'1px solid #F2F2F4'}}>
                    <span style={{color:req?'#1A1A1C':'#8A8A8E',fontWeight:req?700:500}}>{k}{req?' (requested)':''}</span>
                    <span style={{fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{'ocean '+money(r.ocean)+' \u00b7 origin '+money(r.origin)+(r.transit?' \u00b7 '+r.transit+'d':'')}</span>
                  </div>
                );
              })}
              {(parsed.bid.dest_charges||[]).map(function(d,i){
                return (
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:'12px',borderTop:i===0?'2px solid #ECECEE':'1px solid #F6F6F8'}}>
                    <span style={{color:'#4A4A4E'}}>{d.fee}{d.basis?' \u00b7 '+d.basis:''}</span>
                    <span style={{fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(d.amount)}</span>
                  </div>
                );
              })}
              <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderTop:'2px solid #ECECEE',marginTop:'4px',fontSize:'13px'}}>
                <span style={{fontWeight:700,color:'#1A1A1C'}}>{'Effective per '+(parsed.quote.container_type||'40HQ')}</span>
                <span style={{fontWeight:800,color:'#0071E3',fontVariantNumeric:'tabular-nums'}}>{money(bidEffective(parsed.bid, parsed.quote.container_type||'40HQ'))}</span>
              </div>
              {(parsed.bid.accessorials||[]).length>0 && (
                <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'6px'}}>{String((parsed.bid.accessorials||[]).length)+' if-needed fee(s) recorded \u2014 excluded from the total'}</div>
              )}
              <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'4px'}}>{'Valid until: '+(parsed.bid.valid_until||'\u2014')}</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".xlsx" style={{display:'none'}} onChange={e=>{ const f=e.target.files&&e.target.files[0]; if(f) parse(f); }} />
        </div>
        <div style={{padding:'0 24px 20px',display:'flex',justifyContent:'space-between',gap:'8px'}}>
          <button onClick={()=>{setParsed(null); if(fileRef.current) fileRef.current.value='';}} style={{background:'none',border:'none',color:'#8A8A8E',fontSize:'13px',cursor:'pointer',visibility:parsed?'visible':'hidden'}}>Different file</button>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={()=>applied>0?onApplied():onClose()} style={{background:'#F2F2F6',border:'none',borderRadius:'10px',padding:'9px 17px',fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',cursor:'pointer'}}>{applied>0?'Done':'Cancel'}</button>
            {parsed && <button onClick={apply} disabled={busy} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'9px 18px',fontSize:'13.5px',fontWeight:600,cursor:'pointer'}}>{busy?'Saving\u2026':'Save bid'}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Apply a winning bid into the product quote's freight builder ─────────────
const APPLY_CAPS = { '20GP':32, '40GP':58, '40HQ':68, '45HQ':83 };

function ApplyBidModal({ bid, shipQuote, onClose, onDone }) {
  // Its one control is a <select>, which fires change, so events alone cover it.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [pq, setPq] = useState([]);           // product quotes from the quotes DB
  const [selId, setSelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingQ, setLoadingQ] = useState(true);

  useEffect(()=>{
    SBQ.from('quotes').select('id,product,sku,client,units_per_carton,carton_l,carton_w,carton_h,tiers').order('created_at',{ascending:false}).limit(400).then(({data})=>{
      const list = data||[];
      setPq(list);
      // best match: explicit source link → sku/product text → client
      let best = '';
      if (shipQuote.source_quote_id && list.some(q=>q.id===shipQuote.source_quote_id)) best = shipQuote.source_quote_id;
      if (!best) {
        const d = (((shipQuote.line_items||[])[0]||{}).desc||'').toLowerCase().trim();
        if (d) { const hit = list.find(q=>{ const t=((q.product||'')+' '+(q.sku||'')).toLowerCase(); return t.includes(d)||d.includes((q.sku||'').toLowerCase()&& (q.sku||'').toLowerCase()); }); if (hit) best = hit.id; }
      }
      if (!best) {
        const cn = ((shipQuote.client||{}).name||'').toLowerCase().trim();
        if (cn) { const hit = list.find(q=>(q.client||'').toLowerCase().trim()===cn); if (hit) best = hit.id; }
      }
      setSelId(best || (list[0]? list[0].id : ''));
      setLoadingQ(false);
    });
  },[]);

  const chosen = pq.find(q=>q.id===selId) || null;
  const ctType = shipQuote.container_type || '40HQ';
  const cap = APPLY_CAPS[ctType] || 68;

  // units per container from the product quote's carton data
  let unitsPerCtr = 0, cartonMsg = '';
  if (chosen) {
    const upc = Number(chosen.units_per_carton)||0;
    const cbm = (Number(chosen.carton_l)*Number(chosen.carton_w)*Number(chosen.carton_h))/1000000;
    if (upc>0 && isFinite(cbm) && cbm>0) unitsPerCtr = Math.floor(cap/cbm)*upc;
    else cartonMsg = 'This quote is missing carton dimensions or units-per-carton, so per-container costs cannot be spread per unit.';
  }

  // build legs from the bid (per-container basis, spread over unitsPerCtr)
  const rates = (bid.rates||{})[ctType] || {};
  const legsRaw = [];
  if (Number(rates.ocean)>0)  legsRaw.push({ cat:'Ocean freight', amount:Number(rates.ocean) });
  if (Number(rates.origin)>0) legsRaw.push({ cat:'Origin costs',  amount:Number(rates.origin) });
  (bid.dest_charges||[]).forEach(d=>{ if(Number(d.amount)>0) legsRaw.push({ cat:d.fee||'Destination fee', amount:Number(d.amount), desc:d.basis||'' }); });
  const legs = unitsPerCtr>0 ? legsRaw.map(l=>({ cat:l.cat, desc:l.desc||'', basis:'container', amount:l.amount, per:unitsPerCtr, perUnit:+(l.amount/unitsPerCtr).toFixed(4) })) : [];
  const freightPerUnit = legs.reduce((a,l)=>a+l.perUnit,0);

  const apply = async () => {
    if (!chosen || !legs.length) return;
    setBusy(true);
    try {
      const tiers = Array.isArray(chosen.tiers) ? chosen.tiers : [];
      if (!tiers.length) { alert('That quote has no pricing tiers yet — add a tier first, then apply.'); setBusy(false); return; }
      const newTiers = tiers.map(t=>{
        const kept = (Array.isArray(t.fb)?t.fb:[]).filter(l=>l.basis==='pct');   // preserve duty legs
        const fb = legs.concat(kept);
        const total = fb.reduce((a,l)=>a+(Number(l.perUnit)||0),0);
        return { ...t, ship:'ocean', freightAir:null, freightOcean:+total.toFixed(3), fb:fb, duty_only:false };
      });
      const { error } = await SBQ.from('quotes').update({
        tiers: newTiers,
        freight_duty_updated_at: new Date().toISOString(),
        freight_duty_updated_by: 'Bid — '+(bid.forwarder_name||'forwarder'),
      }).eq('id', chosen.id);
      if (error) { alert('Could not update the quote: '+error.message); setBusy(false); return; }
      // applying implies selecting the winner
      await SB.from('forwarder_bids').update({ selected:false }).eq('shipment_quote_id', shipQuote.id);
      await SB.from('forwarder_bids').update({ selected:true }).eq('id', bid.id);
      onDone && onDone();
    } catch (e) {
      alert('Something went wrong: '+(e&&e.message?e.message:e));
    }
    setBusy(false);
  };

  const money = v => '$'+Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const keptDuty = chosen && Array.isArray(chosen.tiers) && chosen.tiers.some(t=>Array.isArray(t.fb)&&t.fb.some(l=>l.basis==='pct'));

  return (
    <div onClick={e=>e.target===e.currentTarget&&guardedClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'36px 16px',zIndex:1200,overflowY:'auto'}}>
      <div ref={cardRef} style={{background:'#fff',borderRadius:'18px',width:'100%',maxWidth:'540px',boxShadow:'0 12px 48px rgba(0,0,0,.22)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 0'}}>
          <div style={{fontSize:'17px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.015em'}}>Apply bid to quote</div>
          <div style={{fontSize:'13px',color:'#8A8A8E',marginTop:'4px',lineHeight:1.5}}>{(bid.forwarder_name||'This bid')+"'s awarded costs become the quote's freight build-up — per-container charges spread across the units that fit a "+ctType+'. Duty legs on the quote are preserved.'}</div>
        </div>
        <div style={{padding:'18px 24px'}}>
          <label style={{display:'block',fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'5px'}}>Product quote</label>
          {loadingQ ? <div style={{fontSize:'13px',color:'#8A8A8E'}}>Loading quotes…</div> : (
            <select value={selId} onChange={e=>setSelId(e.target.value)} style={{width:'100%',border:'1px solid #E5E7EB',borderRadius:'9px',padding:'9px 12px',fontSize:'13px',outline:'none',boxSizing:'border-box',background:'#fff'}}>
              {pq.map(q=><option key={q.id} value={q.id}>{[(q.sku||'').trim(),(q.product||'').trim(),(q.client||'').trim()].filter(Boolean).join(' — ')||q.id.slice(0,8)}</option>)}
            </select>
          )}
          {chosen && shipQuote.source_quote_id===chosen.id && <div style={{fontSize:'11.5px',color:'#15803D',marginTop:'6px',fontWeight:500}}>Linked — this freight quote was generated from this product quote.</div>}
          {cartonMsg && <div style={{fontSize:'12.5px',color:'#B45309',marginTop:'10px',lineHeight:1.5,background:'#FEF3C7',borderRadius:'9px',padding:'9px 12px'}}>{cartonMsg}</div>}
          {chosen && unitsPerCtr>0 && (
            <div style={{marginTop:'14px'}}>
              <div style={{fontSize:'11.5px',color:'#8A8A8E',marginBottom:'8px'}}>{unitsPerCtr.toLocaleString()+' units fit a '+ctType+' · each per-container cost ÷ '+unitsPerCtr.toLocaleString()}</div>
              {legs.map((l,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:'12.5px',borderTop:i>0?'1px solid #F2F2F4':'none'}}>
                  <span style={{color:'#4A4A4E'}}>{l.cat}{l.desc?' · '+l.desc:''} <span style={{color:'#B0B0B4'}}>{money(l.amount)+'/ctr'}</span></span>
                  <span style={{fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{'$'+l.perUnit.toFixed(3)+'/unit'}</span>
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderTop:'2px solid #ECECEE',marginTop:'4px',fontSize:'13px'}}>
                <span style={{fontWeight:700,color:'#1A1A1C'}}>Freight per unit{keptDuty?' (+ existing duty kept)':''}</span>
                <span style={{fontWeight:800,color:'#0071E3',fontVariantNumeric:'tabular-nums'}}>{'$'+freightPerUnit.toFixed(3)}</span>
              </div>
              <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'4px'}}>Applies to every pricing tier on the quote and updates its freight & duty stamp.</div>
            </div>
          )}
        </div>
        <div style={{padding:'0 24px 20px',display:'flex',justifyContent:'flex-end',gap:'8px'}}>
          <button onClick={onClose} style={{background:'#F2F2F6',border:'none',borderRadius:'10px',padding:'9px 17px',fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',cursor:'pointer'}}>Cancel</button>
          <button onClick={apply} disabled={busy||!chosen||!legs.length||unitsPerCtr<=0} style={{background:(!busy&&chosen&&legs.length&&unitsPerCtr>0)?'#0071E3':'#C7C7CC',color:'#fff',border:'none',borderRadius:'10px',padding:'9px 18px',fontSize:'13.5px',fontWeight:600,cursor:(!busy&&chosen&&legs.length&&unitsPerCtr>0)?'pointer':'not-allowed'}}>{busy?'Applying…':'Apply to quote'}</button>
        </div>
      </div>
    </div>
  );
}

function BidsCompareModal({ quote, bids, onClose, onDeleted }) {
  // A viewer -- no controls at all, so it closes silently. ApplyBidModal opens
  // from here but renders outside this card, so it never joins this snapshot.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [applyBid, setApplyBid] = useState(null);
  const ctType = quote.container_type||'40HQ';
  const ct = Math.max(1, Number(quote.containers_needed)||1);
  const sorted = bids.slice().sort((a,b)=>bidEffective(a,ctType)-bidEffective(b,ctType));
  const best = sorted.length ? bidEffective(sorted[0],ctType) : 0;
  const money = v => '$'+Number(v).toLocaleString(undefined,{maximumFractionDigits:0});
  const del = async (id) => { if(!window.confirm('Remove this bid?')) return; await SB.from('forwarder_bids').delete().eq('id',id); onDeleted&&onDeleted(); };
  const selectWinner = async (b) => {
    await SB.from('forwarder_bids').update({ selected:false }).eq('shipment_quote_id', quote.id);
    await SB.from('forwarder_bids').update({ selected:true }).eq('id', b.id);
    onDeleted&&onDeleted();
  };
  return (
    <div onClick={e=>e.target===e.currentTarget&&guardedClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'36px 16px',zIndex:1100,overflowY:'auto'}}>
      <div ref={cardRef} style={{background:'#fff',borderRadius:'18px',width:'100%',maxWidth:'680px',boxShadow:'0 12px 48px rgba(0,0,0,.2)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 14px',borderBottom:'1px solid #ECECEE',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px'}}>
          <div>
            <div style={{fontSize:'17px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.015em'}}>Forwarder quotes</div>
            <div style={{fontSize:'13px',color:'#8A8A8E',marginTop:'3px'}}>{(quote.quote_number||'')+' \u00b7 '+(quote.origin||'?')+' \u2192 '+(quote.destination||'?')+' \u00b7 '+String(ct)+' \u00d7 '+ctType}</div>
          </div>
          <button onClick={onClose} style={{background:'#F2F2F6',border:'none',borderRadius:'50%',width:'28px',height:'28px',fontSize:'15px',color:'#5A5A5E',cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'14px 24px 20px'}}>
          {sorted.length===0 && <div style={{fontSize:'13.5px',color:'#8A8A8E',textAlign:'center',padding:'26px 0'}}>No bids yet. Send the RFQ, then import the replies as they come back.</div>}
          {sorted.map((b,i)=>{
            const per = bidEffective(b,ctType);
            const isBest = i===0 && sorted.length>1;
            const delta = best>0 ? ((per-best)/best)*100 : 0;
            const isSel = !!b.selected;
            return (
              <div key={b.id} style={{border:'1.5px solid '+(isSel?'#0071E3':isBest?'#86EFAC':'#ECECEE'),background:isSel?'#EAF3FE':isBest?'#F0FDF4':'#fff',borderRadius:'14px',padding:'14px 16px',marginBottom:'10px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:'10px',flexWrap:'wrap'}}>
                  <div style={{fontSize:'14px',fontWeight:700,color:'#1A1A1C'}}>
                    {b.forwarder_name}{b.carrier?' \u00b7 '+b.carrier:''}
                    {isSel && <span style={{fontSize:'10.5px',fontWeight:700,color:'#0071E3',background:'#DBEAFE',borderRadius:'6px',padding:'2px 8px',marginLeft:'8px',verticalAlign:'middle'}}>SELECTED</span>}
                    {!isSel && isBest && <span style={{fontSize:'10.5px',fontWeight:700,color:'#15803D',background:'#DCFCE7',borderRadius:'6px',padding:'2px 8px',marginLeft:'8px',verticalAlign:'middle'}}>BEST</span>}
                  </div>
                  <div style={{fontSize:'16px',fontWeight:800,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(per)}<span style={{fontSize:'11px',fontWeight:600,color:'#8A8A8E'}}>/{ctType}</span>{i>0 && <span style={{fontSize:'11px',fontWeight:600,color:'#B45309',marginLeft:'6px'}}>{'+'+delta.toFixed(0)+'%'}</span>}</div>
                </div>
                <div style={{fontSize:'12px',color:'#4A4A4E',marginTop:'6px',lineHeight:1.6}}>
                  {'Shipment total \u2248 '+money(per*ct)+' \u00b7 Transit '+(b.transit_days||'\u2014')+'d \u00b7 Valid until '+(b.valid_until||'\u2014')}
                </div>
                <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'4px'}}>
                  {['Ocean '+(b.ocean_per_container?money(b.ocean_per_container):'\u2014'), b.origin_costs?('Origin '+money(b.origin_costs)):null, b.dest_total?('Destination charges '+money(b.dest_total)):null, (b.accessorials||[]).length?String((b.accessorials||[]).length)+' if-needed fee(s)':null].filter(Boolean).join(' \u00b7 ')}
                </div>
                {b.rates && Object.keys(b.rates).filter(k=>k!==ctType).length>0 && (
                  <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'4px'}}>
                    {'Also quoted: '+Object.keys(b.rates).filter(k=>k!==ctType).map(function(k){ return k+' ocean '+money(b.rates[k].ocean||0); }).join(' \u00b7 ')}
                  </div>
                )}
                {b.notes && <div style={{fontSize:'12px',color:'#4A4A4E',marginTop:'6px',fontStyle:'italic'}}>{b.notes}</div>}
                <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'8px',alignItems:'center'}}>
                  <button onClick={()=>del(b.id)} style={{background:'none',border:'none',color:'#C0C0C4',fontSize:'12px',cursor:'pointer'}}>Remove</button>
                  {!isSel && <button onClick={()=>selectWinner(b)} style={{background:'#F2F2F6',color:'#1A1A1C',border:'none',borderRadius:'8px',padding:'6px 14px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>Select winner</button>}
                  <button onClick={()=>setApplyBid(b)} title="Write this bid's costs into the product quote's freight build-up" style={{background:'#0071E3',color:'#fff',border:'none',borderRadius:'8px',padding:'6px 14px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>Apply to quote →</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {applyBid && <ApplyBidModal bid={applyBid} shipQuote={quote} onClose={()=>setApplyBid(null)} onDone={()=>{ setApplyBid(null); onDeleted&&onDeleted(); alert('Applied. The product quote\'s freight build-up now carries '+(applyBid.forwarder_name||'the bid')+"'s awarded costs."); }} />}
    </div>
  );
}

// ── Shipment Detail / Edit Modal ──────────────────────────────────────────────
function ShipmentDetailModal({ id, onClose, onSaved }) {
  // Fetches the row and populates the form after mount, which is exactly the
  // case the moving baseline exists for -- without it every open-then-close
  // would confirm.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [s, setS] = useState(null);
  const [linkedPO, setLinkedPO] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(()=>{
    SB.from('shipments').select('*').eq('id',id).single().then(({data})=>setS(data||{}));
    SB.from('companies').select('id,name,type').order('name').then(({data})=>setCompanies(data||[]));
    SB.from('shipment_pos').select('purchase_orders(order_number,client:companies!client_company_id(name))').eq('shipment_id',id).limit(1).then(({data})=>{
      if(data?.[0]?.purchase_orders) setLinkedPO(data[0].purchase_orders);
    });
  },[id]);
  const set = (k,v)=>setS(prev=>({...prev,[k]:v}));
  const STAT = ['created','in_transit','at_origin_port','at_transshipment','at_destination_port','customs','out_for_delivery','delivered','delayed','exception','cancelled'];
  const dval = v => v ? String(v).slice(0,10) : '';
  const save = async () => {
    setSaving(true);
    const upd = {
      shipment_number: s.shipment_number||null, status: s.status||'created',
      client_company_id: s.client_company_id||null, carrier_company_id: s.carrier_company_id||null,
      vessel_name: s.vessel_name||null, container_no: s.container_no||null, voyage_no: s.voyage_no||null,
      booking_number: s.booking_number||null, bill_of_lading: s.bill_of_lading||null,
      estimated_departure: dval(s.estimated_departure) ? new Date(dval(s.estimated_departure)+'T12:00:00').toISOString() : null,
      estimated_arrival:   dval(s.estimated_arrival)   ? new Date(dval(s.estimated_arrival)+'T12:00:00').toISOString()   : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await SB.from('shipments').update(upd).eq('id',id);
    setSaving(false);
    if (error){ alert('Error: '+error.message); return; }
    onSaved();
  };
  const [confirmDel, setConfirmDel] = useState(false);
  const deleteShipment = async () => {
    await SB.from('shipment_pos').delete().eq('shipment_id',id);
    await SB.from('shipments').delete().eq('id',id);
    onSaved();
  };
  const clients  = companies.filter(c=>['client','brand','customer'].includes(c.type));
  const carriers = companies.filter(c=>['carrier','freight_forwarder'].includes(c.type));
  return (
    <>
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box">
        <div className="modal-head"><h3>{linkedPO?.order_number || s?.shipment_number || 'Shipment'}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        {!s ? <div className="modal-body">Loading…</div> : (
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>PO #</label><input className="form-input" value={linkedPO?.order_number||s.shipment_number||''} readOnly style={{opacity:.7,cursor:'default'}} /></div>
            <div><label>Status</label><select className="form-select" value={s.status||'created'} onChange={e=>set('status',e.target.value)}>{STAT.map(x=><option key={x} value={x}>{x.replace(/_/g,' ')}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Client</label><input className="form-input" value={(linkedPO?.client?.name||s.companies?.name||'—').toUpperCase()} readOnly style={{opacity:.7,cursor:'default',fontWeight:600}} /></div>
            <div><label>Carrier / Forwarder</label><select className="form-select" value={s.carrier_company_id||''} onChange={e=>set('carrier_company_id',e.target.value)}><option value="">—</option>{companies.filter(c=>['carrier','freight_forwarder'].includes(c.type)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Vessel / Boat</label><input className="form-input" value={s.vessel_name||''} onChange={e=>set('vessel_name',e.target.value)} placeholder="e.g. MAERSK SELETAR" /></div>
            <div><label>Voyage #</label><input className="form-input" value={s.voyage_no||''} onChange={e=>set('voyage_no',e.target.value)} placeholder="e.g. 084W" /></div>
          </div>
          <div className="form-row-2">
            <div><label>Container #</label><input className="form-input" value={s.container_no||''} onChange={e=>set('container_no',e.target.value)} placeholder="e.g. MSKU1234567" /></div>
            <div><label>Booking #</label><input className="form-input" value={s.booking_number||''} onChange={e=>set('booking_number',e.target.value)} /></div>
          </div>
          <div className="form-row"><label>Bill of Lading</label><input className="form-input" value={s.bill_of_lading||''} onChange={e=>set('bill_of_lading',e.target.value)} /></div>
          <div className="form-row-2">
            <div><label>ETD</label><input type="date" className="form-input" value={dval(s.estimated_departure)} onChange={e=>set('estimated_departure',e.target.value)} /></div>
            <div><label>ETA</label><input type="date" className="form-input" value={dval(s.estimated_arrival)} onChange={e=>set('estimated_arrival',e.target.value)} /></div>
          </div>
        </div>
        )}
        <div className="modal-foot"><button className="btn btn-ghost btn-sm" style={{color:'var(--hot)',marginRight:'auto'}} onClick={()=>setConfirmDel(true)}>Delete</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={save} disabled={saving||!s}>{saving?'Saving…':'Save shipment'}</button></div>
      </div>
    </div>
    {confirmDel && <ConfirmModal title="Delete shipment?" message="POs will be unlinked. This cannot be undone." onConfirm={()=>{setConfirmDel(false);deleteShipment();}} onCancel={()=>setConfirmDel(false)} />}
    </>
  );
}


// ── Create PO Modal ───────────────────────────────────────────────────────────
function CreatePOModal({ onClose, onCreated, initialQuote=null }) {
  // markDirty for the sample-type chips only. applyQuote, pickTier (which calls
  // applyQuote), addExtraFromQuote and rmItem all rewrite form fields and item
  // rows that ARE inputs, so the snapshot already sees them.
  const { ref: cardRef, guardedClose, markDirty } = useDirtyGuard(onClose);
  const [mode, setMode]   = useState('quote'); // 'quote' | 'manual'
  const [factories, setFactories] = useState([]);
  const [clients, setClients] = useState([]);
  const [products,  setProducts]  = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [qLoading, setQLoading] = useState(true);
  const [qSearch, setQSearch] = useState('');
  const [picked, setPicked] = useState(null);   // chosen quote (form-shaped)
  const [tierIdx, setTierIdx] = useState(0);
  const [addingItem, setAddingItem] = useState(false);
  const [extraSearch, setExtraSearch] = useState('');
  const [extraPick, setExtraPick] = useState(null);
  const [extraTierIdx, setExtraTierIdx] = useState(0);
  const [extraMsg, setExtraMsg] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [refsReady, setRefsReady] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [items, setItems] = useState([{prodId:'',desc:'',qty:'',price:'',ci:'',carton:''}]);
  const [srchIdx, setSrchIdx] = useState(-1);
  const [srchHits, setSrchHits] = useState([]);
  const [srchRect, setSrchRect] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const onPickPOItem = (li) => setItems(prev=>[...prev,{prodId:'',desc:li.desc,qty:li.qty,price:li.price,ci:'',carton:'',vpn:'',masterSku:'',packSku:'',babySku:'',retailPrice:'',sizeScales:[],sizeQty:{},sizePrice:{}}]);
  const [recentDescs, setRecentDescs] = useState([]);
  const [form, setForm]  = useState({ factoryId:'', clientId:'', num:'', date:nowDate(), ship:'', cancel:'', inco:'', pay:'', dep:'', mold:'', sample:'', currency:'USD', notes:'', pallet:'', needs_samples:false, sample_type:'', sample_qty:'', sample_date:'' });
  const f = k => v => setForm(prev=>({...prev,[k]:v}));

  // Build the next sequential PO number, e.g. KUI-PO-2026-007, from existing ones.
  const genNum = (list=[]) => {
    const year = new Date().getFullYear();
    const prefix = `KUI-PO-${year}-`;
    const max = (list||[]).reduce((m,n)=>{
      if(typeof n!=='string'||!n.startsWith(prefix)) return m;
      const tail=parseInt(n.slice(prefix.length),10);
      return isNaN(tail)?m:Math.max(m,tail);
    },0);
    return prefix+String(max+1).padStart(3,'0');
  };

  useEffect(()=>{
    Promise.all([
      SB.from('companies').select('id,name').eq('type','factory').order('name'),
      SB.from('products').select('id,sku,name').order('sku',{nullsFirst:false}),
      SB.from('companies').select('id,name,vendor_number,pallet_info,shipping_address').eq('type','client').order('name'),
      SB.from('purchase_order_items').select('description').not('description','is',null).limit(200),
      SBQ.from('quotes').select('product').not('product','is',null).limit(300)
    ]).then(([{data:fac},{data:pro},{data:cli},{data:itmD},{data:qProds}])=>{
      setFactories(fac||[]); setProducts(pro||[]); setClients(cli||[]);
      const poDescs=(itmD||[]).map(it=>it.description||'').filter(Boolean);
      const qNames=(qProds||[]).map(q=>q.product||'').filter(Boolean);
      setRecentDescs([...new Set([...poDescs,...qNames])]);
      setRefsReady(true);
    });
    // auto-number this PO based on what's already in the system
    SB.from('purchase_orders').select('order_number').then(({data})=>{
      setForm(prev=> prev.num && !/-$/.test(prev.num) ? prev : {...prev, num: genNum((data||[]).map(r=>r.order_number))});
    });
    // quotes live in the public schema (migrated quotes platform)
    SBQ.from('quotes').select('*').order('created_at',{ascending:false}).then(({data})=>{
      setQuotes(data||[]); setQLoading(false);
    });
  },[]);

  const addItem = () => setItems(prev=>[...prev,{prodId:'',desc:'',qty:'',price:'',ci:'',carton:'',sizeScales:[],sizeQty:{},sizePrice:{}}]);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const addNewClient = async () => {
    const name = newClientName.trim(); if (!name) return;
    const { data: co } = await SB.from('companies').upsert({name,type:'client'},{onConflict:'name,type'}).select('id,name,pallet_info,shipping_address').single();
    if (co){ setClients(prev=>[...prev.filter(c=>c.id!==co.id),co]); f('clientId')(co.id); if(co.pallet_info)f('pallet')(co.pallet_info); if(co.shipping_address&&!form.delivery_address)f('delivery_address')(co.shipping_address); }
    setShowNewClient(false); setNewClientName('');
  };
  const [saveMsg, setSaveMsg] = useState('');
  const saveAsProductsAndQuotes = async () => {
    const filled = items.filter(it=>it.desc.trim());
    if (!filled.length){ setSaveMsg('error:Add at least one product description first.'); setTimeout(()=>setSaveMsg(''),3000); return; }
    const clientName = (clients.find(c=>c.id===form.clientId)||{}).name||'';
    const factoryName = (factories.find(fc=>fc.id===form.factoryId)||{}).name||'';
    let saved=0, errors=[];
    for (const it of filled){
      const name = it.desc.trim();
      const { data: existing } = await SB.from('products').select('id').eq('name',name).maybeSingle();
      if (!existing) {
        const { error: pErr } = await SB.from('products').insert({name, sku:it.prodId||null});
        if (pErr) errors.push('Product: '+pErr.message);
      }
      const tier = {qty:Number(it.qty)||1, exw:Number(it.price)||0, ship:0, freightAir:0, freightOcean:0, landed:Number(it.price)||0, client:Number(it.price)||0};
      const { error: qErr } = await SB.from('quotes').insert({
        product:name, sku:it.prodId||null, client:clientName||null, factory:factoryName||null,
        quote_date:form.date||new Date().toISOString().split('T')[0],
        tiers:[tier], status:'active'
      });
      if (qErr) errors.push('Quote: '+qErr.message);
      else saved++;
    }
    if (errors.length) setSaveMsg('error:'+errors[0]);
    else setSaveMsg(saved+' product'+(saved!==1?'s':'')+' saved to Products and Quotes.');
    setTimeout(()=>setSaveMsg(''),4000);
  };
  const handleProdInput = (i,v,el) => {
    setItem(i,'desc',v);
    if(v.trim().length>0){
      const lv=v.toLowerCase();
      const cat=(products||[]).filter(p=>(p.name||'').toLowerCase().includes(lv)||(p.sku||'').toLowerCase().includes(lv)).map(p=>({id:p.id,name:p.name,sku:p.sku||'',recent:false}));
      const rec=recentDescs.filter(d=>d.toLowerCase().includes(lv)&&!cat.some(c=>c.name===d)).slice(0,5).map(d=>({id:null,name:d,sku:'',recent:true}));
      const h=[...cat,...rec].slice(0,8);
      setSrchHits(h); setSrchIdx(i);
      if(el){const r=el.getBoundingClientRect();setSrchRect({top:r.bottom+2,left:r.left,w:Math.max(r.width,240)});}
    } else { setSrchIdx(-1); setSrchHits([]); setSrchRect(null); }
  };
  const pickProd = async (i,p) => {
    setItem(i,'desc',p.name); setItem(i,'prodId',p.id||'');
    setSrchIdx(-1); setSrchHits([]); setSrchRect(null);
    // autofill carton + CI from the most recent PO that used this product name
    try {
      const {data} = await SB.from('purchase_order_items').select('carton_info,ci_value').ilike('description',p.name).limit(1);
      if (data?.[0]) {
        if (data[0].carton_info) setItem(i,'carton',data[0].carton_info);
        if (data[0].ci_value!=null) setItem(i,'ci',String(data[0].ci_value));
      }
    } catch(e){}
  };
  const setItem = (i,k,v) => setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[k]:v}:it));
  const rmItem  = i => setItems(prev=>prev.filter((_,idx)=>idx!==i));
  // Seed every size at the line's unit price, so a flat-priced product needs no
  // typing and only an upcharge gets edited. Blank price leaves the boxes blank.
  const seedPrices = (scales, price) => (price !== '' && price != null)
    ? sizesForSelection(scales).reduce((a,e)=>({...a,[e.key]:String(price)}),{}) : {};
  // Seeds only what a newly ticked scale brings in, leaving prices already typed
  // for a scale that stays selected exactly where they are.
  const setSizeScales = (i,next) => setItems(prev=>prev.map((it,idx)=>{
    if(idx!==i) return it;
    const had=new Set(sizesForSelection(it.sizeScales).map(e=>e.key));
    const seed={...(it.sizePrice||{})};
    if(it.price!==''&&it.price!=null){
      sizesForSelection(next).forEach(e=>{ if(!had.has(e.key)&&seed[e.key]==null) seed[e.key]=String(it.price); });
    }
    return {...it, sizeScales:next, sizePrice:seed};
  }));
  const setSizeQty   = (i,key,v) => setItems(prev=>prev.map((it,idx)=>idx===i?{...it,sizeQty:{...(it.sizeQty||{}),[key]:v}}:it));
  const setSizePrice = (i,key,v) => setItems(prev=>prev.map((it,idx)=>idx===i?{...it,sizePrice:{...(it.sizePrice||{}),[key]:v}}:it));
  // A sized line takes its quantity from the grid; an unsized line keeps its own box.
  const lineQty = it => sizesForSelection(it.sizeScales).length?sizesForSelection(it.sizeScales).reduce((a,e)=>a+(Number((it.sizeQty||{})[e.key])||0),0):(Number(it.qty)||0);
  // A size with no price of its own falls back to the line's unit price -- the same
  // rule the save path uses, so the Amount column cannot disagree with what is written.
  const sizePriceOf = (it,k) => { const v=(it.sizePrice||{})[k]; return v===''||v==null?(Number(it.price)||0):(Number(v)||0); };
  const lineAmt = it => sizesForSelection(it.sizeScales).length?sizesForSelection(it.sizeScales).reduce((a,e)=>a+(Number((it.sizeQty||{})[e.key])||0)*sizePriceOf(it,e.key),0):(Number(it.qty)||0)*(Number(it.price)||0);
  const lineUnit = it => { const q=lineQty(it); return q>0?lineAmt(it)/q:0; };

  // tiers stored as jsonb on each quote row
  const tiersOf = q => { try { return Array.isArray(q.tiers)?q.tiers:(q.tiers?JSON.parse(q.tiers):[]); } catch { return []; } };
  const qPrice  = q => { const t=tiersOf(q).map(x=>Number(x.client)||0).filter(Boolean); return t.length?Math.min(...t):null; };

  const filteredQuotes = quotes.filter(q=>{
    const s=qSearch.toLowerCase(); if(!s) return true;
    return `${q.product} ${q.client} ${q.factory} ${q.sku} ${q.country}`.toLowerCase().includes(s);
  });

  // Resolve a quote's free-text client name to an existing company row.
  // Exact match only — trimmed and case-insensitive. No fuzzy contains match
  // (it resolved any "Legoland <region>" variant to the generic "Legoland" row)
  // and no auto-create; an unmatched client is left for the user to pick.
  const findClient = name => {
    const n = (name||'').trim().toLowerCase();
    return n ? clients.find(c=>(c.name||'').trim().toLowerCase()===n) : undefined;
  };

  // Resolve a quote to the product it is for, or to nothing.
  //
  // Matches on SKU **and** name together, both trimmed, both required to be non-blank.
  // The rule this replaces was "SKU else name" over products.find():
  //
  //   products.find(p => (q.sku && p.sku.toLowerCase() === q.sku.toLowerCase())
  //                   || p.name.toLowerCase() === q.product.toLowerCase())
  //
  // Three faults, and the third is the reason for the change.
  //
  //   It did not trim, unlike findClient directly above, so "BUC-152 " and "BUC-152"
  //   were different products.
  //
  //   Only the SKU clause checked the quote had one. The name clause compared
  //   unconditionally, so a quote with no product name compared '' against every
  //   product name and matched any product whose name was blank.
  //
  //   products.sku is NOT unique -- 29 SKUs across 60 rows -- so SKU-alone is ambiguous
  //   for 8 of the PO item rows, and find() silently took whichever sorted first.
  //   JON-106 resolves to both "Wine Container White" and "Wine Chiller"; LL1-380 to a
  //   Small, a Medium and a Large. Picking one asserts a product nobody chose.
  //
  // The pair is products' own natural key -- products_sku_name_key = UNIQUE (sku, name)
  // -- so matching on both is matching on the real identity of a product. All 141
  // quote-sourced PO item rows resolved to exactly one product this way in the backfill,
  // with nothing left ambiguous, which is why no tie-break is needed here either.
  //
  // Returns '' rather than guessing when the pair does not resolve. An unset product on
  // a line is recoverable -- the per-line picker is right there -- and a wrong one is
  // not, because nothing downstream ever questions it again.
  const productIdForQuote = (q) => {
    const sku  = (q?.sku || '').trim().toLowerCase();
    const name = (q?.product || '').trim().toLowerCase();
    if (!sku || !name) return '';
    const hits = products.filter(p =>
      (p.sku || '').trim().toLowerCase() === sku &&
      (p.name || '').trim().toLowerCase() === name);
    return hits.length === 1 ? hits[0].id : '';
  };

  // when a quote+tier is chosen, prefill the PO form & line item
  const applyQuote = async (q, ti=0) => {
    setPicked(q); setTierIdx(ti);
    const tiers=tiersOf(q); const t=tiers[ti]||{};
    const matchFactory = factories.find(fc=>(fc.name||'').toLowerCase()===(q.factory||'').toLowerCase());
    const matchClient = findClient(q.client);
    setClientNote(matchClient ? '' : (q.client||'').trim());
    setForm(prev=>({...prev,
      factoryId: matchFactory?matchFactory.id:prev.factoryId,
      clientId: matchClient?matchClient.id:prev.clientId,
      pallet: (matchClient&&matchClient.pallet_info)?matchClient.pallet_info:prev.pallet,
      delivery_address: (matchClient&&matchClient.shipping_address&&!prev.delivery_address)?matchClient.shipping_address:prev.delivery_address,
      inco: q.country?'FOB '+q.country:prev.inco,
      mold: q.mold_fee!=null?String(q.mold_fee):prev.mold,
      sample: q.sample_fee!=null?String(q.sample_fee):prev.sample,
      notes: prev.notes || (q.notes||''),
    }));
    const qScale = toScaleList(q.size_scale);
    const qPrice = t.landed!=null?String(t.landed):'';
    setItems([{ prodId: productIdForQuote(q), desc: q.product||'', qty: t.qty!=null?String(t.qty):'', price: qPrice, ci:'', carton:'', sizeScales: qScale, sizeQty:{}, sizePrice: seedPrices(qScale,qPrice) }]);
  };
  const pickTier = ti => { if(picked) applyQuote(picked, ti); };
  const addExtraFromQuote = async (q, ti) => {
    const tiers = tiersOf(q);
    const t = tiers[ti] ?? tiers[0];
    if (!t) { alert('Could not read tier data — try re-selecting the quote.'); return; }
    const xScale = toScaleList(q.size_scale);
    const xPrice = t.landed!=null?String(t.landed):'';
    // Matched too. This line comes from a quote just as items[0] does; leaving it
    // blank was why a multi-line PO could only ever carry one resolved product.
    const newItem = { prodId:productIdForQuote(q), desc:q.product||'', qty:t.qty!=null?String(t.qty):'', price:xPrice, ci:'', carton:'', sizeScales:xScale, sizeQty:{}, sizePrice:seedPrices(xScale,xPrice) };
    setItems(prev=>[...prev, newItem]);
    // If no client set yet on this PO, pull it from this quote's client
    if (!form.clientId && q.client) {
      const mc = findClient(q.client);
      if (mc) setForm(prev=>({...prev,clientId:mc.id,pallet:mc.pallet_info||prev.pallet,delivery_address:(mc.shipping_address&&!prev.delivery_address)?mc.shipping_address:prev.delivery_address}));
      setClientNote(mc ? '' : (q.client||'').trim());
    }
    setAddingItem(false); setExtraPick(null); setExtraSearch(''); setExtraTierIdx(0);
    setExtraMsg('✓ '+( q.product||'Item')+' added to line items');
    setTimeout(()=>setExtraMsg(''), 3000);
  };

  // when opened from a product card, seed the chosen quote once refs are ready
  useEffect(()=>{
    if(initialQuote && refsReady && !seeded){ applyQuote(initialQuote, 0); setSeeded(true); }
  },[initialQuote, refsReady, seeded]);

  const submit  = async () => {
    if (!form.factoryId||!form.num) { alert('Factory and PO number required'); return; }
    const valid = items.filter(it => (it.prodId || (it.desc||'').trim()) && lineQty(it)>0);
    if (valid.length===0) { alert('Add at least one line item with a quantity greater than 0 before creating the PO.'); return; }
    const baseFields = {
      factory_company_id:form.factoryId, client_company_id:form.clientId||null, pallet_info:form.pallet||null, order_date:form.date,
      requested_ship_date:form.ship||null, cargo_ready_date:form.ship||null, cancel_date:form.cancel||null, incoterm:form.inco||null, payment_terms:form.pay||null,
      deposit_percent:Number(form.dep)||null, mold_fee:Number(form.mold)||0, sample_fee:Number(form.sample)||0,
      currency:form.currency, notes:form.notes||null, status:'draft',
      needs_samples:!!form.needs_samples, sample_type:form.needs_samples?(form.sample_type||null):null, sample_qty:form.needs_samples?(Number(form.sample_qty)||null):null, sample_date:form.needs_samples?(form.sample_date||null):null,
      testing_required:!!form.testing_required, delivery_address:form.delivery_address||null, shipping_method:form.shipping_method||null,
      source_quote_id: picked?.id || null
    };
    let po=null, lastErr=null, orderNumber=form.num;
    for (let attempt=0; attempt<4 && !po; attempt++){
      const { data, error } = await SB.from('purchase_orders').insert({ ...baseFields, order_number:orderNumber }).select().single();
      if (!error){ po=data; break; }
      lastErr=error;
      const msg = (error.message||'').toLowerCase();
      if (/order_number|duplicate key/i.test(msg)){
        const { data:rows } = await SB.from('purchase_orders').select('order_number');
        orderNumber = genNum((rows||[]).map(r=>r.order_number));
        setForm(prev=>({...prev,num:orderNumber}));
        continue;
      }
      if (/load failed|network|fetch|failed to fetch/i.test(msg)){
        // iOS Safari sometimes aborts fetch — wait and retry
        await new Promise(r=>setTimeout(r, 800*(attempt+1)));
        continue;
      }
      if (/source_quote_id|foreign key|violates/i.test(msg)){
        // FK constraint on source_quote_id — retry without it
        baseFields.source_quote_id = null;
        continue;
      }
      break;
    }
    if (!po) { alert('Error creating PO: '+(lastErr?.message||'unknown')); return; }
    let added=0, failed=[];
    // A sized line expands to one row per size carrying a quantity; an unsized line
    // still writes exactly one row, with size NULL. vpn / master_sku / pack_sku /
    // baby_sku are user-entered rather than derived, so the size column carries the
    // size alone and no SKU field is rewritten.
    const rowsFor = it => {
      const base={ purchase_order_id:po.id, product_id:it.prodId||null, quantity:Number(it.qty), unit_price:Number(it.price)||0, currency:form.currency, ci_value:Number(it.ci)||null, carton_info:it.carton||null, vpn:it.vpn||null, master_sku:it.masterSku||null, pack_sku:it.packSku||null, baby_sku:it.babySku||null, retail_price:it.retailPrice?Number(it.retailPrice):null };
      const entries=sizesForSelection(it.sizeScales);
      if (!entries.length) return [{ ...base, size:null }];
      // Qualified for the same reason as the SO path: two Ls on one PO would print
      // identically on the document the factory works from.
      return entries.map(e=>({e,q:Number((it.sizeQty||{})[e.key])||0})).filter(x=>x.q>0)
        .map(x=>({ ...base, quantity:x.q, unit_price:sizePriceOf(it,x.s), size:x.s }));
    };
    for (const it of valid) {
      const hasDesc=(it.desc||'').trim();
      for (const row of rowsFor(it)) {
        let { error:e1 } = await SB.from('purchase_order_items').insert({ ...row, description:hasDesc||null });
        if (e1 && /description/i.test(e1.message)) {
          // description column not added yet (migration 007) — insert without it
          const r = await SB.from('purchase_order_items').insert(row);
          e1 = r.error;
        }
        if (e1) failed.push(e1.message); else added++;
      }
    }
    if (failed.length) alert('PO created, but '+failed.length+' line item(s) failed:\n'+failed[0]);
    onCreated(po.id);
  };

  return (
    <>
    {showPicker && <QuotePickerModal priceField="landed" onPick={onPickPOItem} onClose={()=>setShowPicker(false)} />}
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box modal-lg">
        <div className="modal-head"><h3>New Purchase Order</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">

          {/* mode toggle */}
          <div className="qp-toggle">
            <button className={mode==='quote'?'on':''} onClick={()=>setMode('quote')}>Generate from Quote</button>
            <button className={mode==='manual'?'on':''} onClick={()=>{setMode('manual');setPicked(null);}}>Manual Entry</button>
          </div>

          {/* selected-quote banner */}
          {picked && (
            <div className="qp-banner">
              <span><b>{picked.product||'Quote'}</b>{' \u00b7 '}{picked.client||'—'}{picked.sku?' \u00b7 '+picked.sku:''}</span>
              <button className="x" onClick={()=>{setPicked(null);setItems([{prodId:'',desc:'',qty:'',price:'',ci:'',carton:''}]);}}>Change</button>
            </div>
          )}

          {/* QUOTE PICKER */}
          {mode==='quote' && !picked && (
            <>
              <div className="qp-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input data-noguard placeholder="Search quotes — product, client, factory, SKU…" value={qSearch} onChange={e=>setQSearch(e.target.value)} autoFocus />
              </div>
              {qLoading ? <div className="loading">Loading quotes…</div> : (
                <div className="qp-list">
                  {filteredQuotes.length===0 && <div className="empty" style={{padding:'40px 20px'}}><p>No quotes match.</p></div>}
                  {filteredQuotes.map(q=>{
                    const tiers=tiersOf(q); const price=qPrice(q);
                    return (
                      <button key={q.id} className="qp-card" onClick={()=>applyQuote(q,0)}>
                        <span className="qp-avatar" style={{background:companyColor(q.client),color:'#0b1120'}}>{initials(q.client)}</span>
                        <span className="qp-meta">
                          <div className="qp-prod">{q.product||'Untitled product'}</div>
                          <div className="qp-sub">{q.client||'—'}{q.factory?` · ${q.factory}`:''}{q.sku?` · ${q.sku}`:''}</div>
                        </span>
                        <span className="qp-right">
                          <div className="qp-price">{price!=null?money(price):'—'}</div>
                          <div className="qp-tiers">{tiers.length} {tiers.length===1?'tier':'tiers'}</div>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* tier picker once a quote is chosen */}
          {mode==='quote' && picked && tiersOf(picked).length>0 && (
            <div className="form-row">
              <label>Pricing Tier — pick the quantity to build this PO from</label>
              <div className="qp-tierpick">
                {tiersOf(picked).map((t,i)=>(
                  <button key={i} className={i===tierIdx?'on':''} onClick={()=>pickTier(i)}>
                    {t.qty?Number(t.qty).toLocaleString():'—'} @ {t.landed?money(Number(t.landed)):'—'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SHARED PO FORM — shown for manual, or after a quote is picked */}
          {(mode==='manual' || picked) && (
          <>

          {/* ── Add extra product from quote (above Factory) ── */}
          {mode==='quote' && picked && (
            <div className="extra-item-bar">
              {extraMsg && <div style={{fontSize:'13px',color:'#059669',fontWeight:600,marginBottom:'8px',padding:'8px 12px',background:'#d1fae5',borderRadius:'8px'}}>✓ {extraMsg.replace('✓ ','')}</div>}
              {!addingItem ? (
                <button className="btn btn-ghost btn-sm" style={{width:'100%',justifyContent:'center',marginBottom:'4px'}} onClick={()=>setAddingItem(true)}>+ Add item from quote</button>
              ) : (
                <div className="extra-item-panel">
                  <div className="extra-item-head">
                    <span>Add another product</span>
                    <button className="modal-close" onClick={()=>{setAddingItem(false);setExtraPick(null);setExtraSearch('');}}>×</button>
                  </div>
                  {!extraPick ? (
                    <>
                      <div className="qp-search" style={{margin:'10px 0 8px'}}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                        <input data-noguard placeholder="Search quotes — product, client…" value={extraSearch} onChange={e=>setExtraSearch(e.target.value)} autoFocus />
                      </div>
                      <div className="qp-list" style={{maxHeight:'200px',borderRadius:'10px',border:'1px solid var(--line)',marginBottom:'12px'}}>
                        {(()=>{
                          const lv=(extraSearch||'').toLowerCase().trim();
                          const qs=lv?quotes.filter(q=>(q.product||'').toLowerCase().includes(lv)||(q.client||'').toLowerCase().includes(lv)||(q.factory||'').toLowerCase().includes(lv)):quotes;
                          return qs.length===0
                            ? <div style={{padding:'16px',fontSize:'13px',color:'var(--muted)'}}>No quotes match.</div>
                            : qs.slice(0,12).map(q=>{ const trs=tiersOf(q); const pr=qPrice(q); return (
                              <button key={q.id} className="qp-card" onClick={()=>{setExtraPick(q);setExtraTierIdx(0);}}>
                                <span className="qp-avatar" style={{background:companyColor(q.client),color:'#0b1120'}}>{initials(q.client)}</span>
                                <span className="qp-meta"><div className="qp-prod">{q.product||'Untitled'}</div><div className="qp-sub">{q.client||'—'}{q.factory?` · ${q.factory}`:''}</div></span>
                                <span className="qp-right"><div className="qp-price">{pr!=null?money(pr):'—'}</div><div className="qp-tiers">{trs.length} tier{trs.length!==1?'s':''}</div></span>
                              </button>
                            );});
                        })()}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="qp-banner" style={{margin:'10px 0'}}>
                        <span><b>{extraPick.product||'Quote'}</b> · {extraPick.client||'—'}</span>
                        <button className="x" onClick={()=>setExtraPick(null)}>Change</button>
                      </div>
                      <div className="form-row" style={{marginBottom:'12px'}}>
                        <label>Pricing Tier</label>
                        <div className="qp-tierpick">
                          {tiersOf(extraPick).map((t,i)=>(
                            <button key={i} className={i===extraTierIdx?'on':''} onClick={()=>setExtraTierIdx(i)}>
                              {t.qty?Number(t.qty).toLocaleString():'—'} @ {t.landed?money(Number(t.landed)):'—'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button className="btn btn-dark btn-sm" style={{marginBottom:'12px'}} onClick={()=>addExtraFromQuote(extraPick,extraTierIdx)}>Add to PO →</button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-row" style={{marginTop:picked?4:0}}><label>Factory *</label>
            <select className="form-select" value={form.factoryId} onChange={e=>f('factoryId')(e.target.value)}>
              <option value="">Select factory...</option>
              {factories.map(fc=><option key={fc.id} value={fc.id}>{fc.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Client <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(for tracking &amp; inventory — never shown on the factory PO)</span></label>
            <select className="form-select" value={form.clientId} onChange={e=>{const cid=e.target.value;const c=clients.find(x=>x.id===cid);setForm(prev=>({...prev,clientId:cid,pallet:(c&&c.pallet_info&&!prev.pallet)?c.pallet_info:prev.pallet,delivery_address:(c&&c.shipping_address&&!prev.delivery_address)?c.shipping_address:prev.delivery_address}));}}>
              <option value="">Unassigned</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {clientNote && !form.clientId && <div style={{fontSize:'12px',color:'#d97706',marginTop:'6px'}}>No client matches “{clientNote}” from the quote — pick one above.</div>}
            {!showNewClient
              ? <button className="btn btn-ghost btn-sm" style={{marginTop:'8px'}} onClick={()=>setShowNewClient(true)}>+ New client</button>
              : <div style={{display:'flex',gap:'8px',marginTop:'8px',alignItems:'center'}}>
                  <input className="form-input" style={{flex:1}} placeholder="Client name…" value={newClientName} onChange={e=>setNewClientName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNewClient()} autoFocus />
                  <button className="btn btn-dark btn-sm" onClick={addNewClient}>Add</button>
                  <button className="btn btn-ghost btn-sm" onClick={()=>{setShowNewClient(false);setNewClientName('');}}>✕</button>
                </div>
            }
            {(()=>{ const c=clients.find(x=>x.id===form.clientId); return c?.vendor_number ? <div style={{fontSize:'12px',color:'var(--muted)',marginTop:'6px'}}>Vendor # <b style={{color:'var(--ink)'}}>{c.vendor_number}</b></div> : null; })()}
          </div>
          <div className="form-row"><label>Pallet instructions <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(prints on the factory PO)</span></label>
            <input className="form-input" value={form.pallet} onChange={e=>f('pallet')(e.target.value)} placeholder="Autofills from the client — edit if needed" />
          </div>
          <div className="form-row-2">
            <div><label>PO Number *</label><input className="form-input" value={form.num} onChange={e=>f('num')(e.target.value)} /></div>
            <div><label>Order Date</label><input type="date" className="form-input" value={form.date} onChange={e=>f('date')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>CRD <span style={{color:'var(--faint)',fontWeight:400,letterSpacing:0,textTransform:'none'}}>cargo ready date</span></label><input type="date" className="form-input" value={form.ship} onChange={e=>f('ship')(e.target.value)} /></div>
            <div><label>Cancel Date</label><input type="date" className="form-input" value={form.cancel} onChange={e=>f('cancel')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Incoterm (EXW / FOB)</label><input className="form-input" placeholder="e.g. FOB HCMC" value={form.inco} onChange={e=>f('inco')(e.target.value)} /></div>
            <div></div>
          </div>
          <div className="form-row-2">
            <div><label>Payment Terms</label><input className="form-input" placeholder="e.g. 30/70" value={form.pay} onChange={e=>f('pay')(e.target.value)} /></div>
            <div><label>Deposit %</label><input type="number" className="form-input" placeholder="30" value={form.dep} onChange={e=>f('dep')(e.target.value)} /></div>
          </div>
          <span className="form-section-label">Line Items</span>
          <table className="items-table">
            <thead><tr><th style={{width:'40%'}}>Product</th><th>Qty</th><th>Unit Price</th><th style={{textAlign:'right'}}>Amount</th><th style={{width:'36px'}}></th></tr></thead>
            <tbody>
              {items.map((it,i)=>(
                <React.Fragment key={i}>
                  <tr>
                    <td>
                      <input value={it.desc} onChange={e=>handleProdInput(i,e.target.value,e.target)} onBlur={()=>setTimeout(()=>{setSrchIdx(-1);setSrchHits([]);setSrchRect(null);},200)} placeholder="Type to search products…" />
                    </td>
                    <td>{sizesForSelection(it.sizeScales).length
                      ? <div className="qty-from-sizes" title="Quantity comes from the size breakdown below"><span className="qfs-v">{lineQty(it).toLocaleString()}</span><span className="qfs-k">from sizes</span></div>
                      : <input type="number" value={it.qty} onChange={e=>setItem(i,'qty',e.target.value)} placeholder="0" />}</td>
                    <td>{sizesForSelection(it.sizeScales).length
                      ? <div className="qty-from-sizes" title="Blended unit price from the size breakdown below"><span className="qfs-v">{lineUnit(it).toFixed(2)}</span><span className="qfs-k">from sizes</span></div>
                      : <input type="number" step="0.00001" value={it.price} onChange={e=>setItem(i,'price',e.target.value)} placeholder="0.00" />}</td>
                    <td className="mono" style={{textAlign:'right',whiteSpace:'nowrap',fontSize:'12.5px'}}>{money(lineAmt(it),form.currency)}</td>
                    <td><button className="rm" onClick={()=>rmItem(i)}>×</button></td>
                  </tr>
                  <tr className="item-sub-row">
                    <td colSpan={5}>
                      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',padding:'4px 0 4px'}}>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>CI Value ($)</span><input type="number" step="0.00001" className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.ci||''} onChange={e=>setItem(i,'ci',e.target.value)} placeholder="0.00" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'1 1 180px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>Carton info</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.carton||''} onChange={e=>setItem(i,'carton',e.target.value)} placeholder="e.g. 12 pcs/ctn, 60×40×30 cm, 11 kg" /></div>
                      </div>
                      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',padding:'0 0 8px'}}>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 90px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>VPN #</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.vpn||''} onChange={e=>setItem(i,'vpn',e.target.value)} placeholder="VPN" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Master SKU</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.masterSku||''} onChange={e=>setItem(i,'masterSku',e.target.value)} placeholder="Master" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Pack SKU</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.packSku||''} onChange={e=>setItem(i,'packSku',e.target.value)} placeholder="Pack" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Baby SKU</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.babySku||''} onChange={e=>setItem(i,'babySku',e.target.value)} placeholder="Baby" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'#7c3aed'}}>Retail Price</span><input type="number" step="0.00001" className="form-input" style={{padding:'5px 8px',fontSize:'12px'}} value={it.retailPrice||''} onChange={e=>setItem(i,'retailPrice',e.target.value)} placeholder="0.00" /></div>
                      </div>
                      <div style={{padding:'0 0 8px'}}>
                        <SizeGrid scales={it.sizeScales||[]} onScalesChange={ks=>setSizeScales(i,ks)} quantities={it.sizeQty||{}} onQuantityChange={(k,v)=>setSizeQty(i,k,v)} prices={it.sizePrice||{}} onPriceChange={(k,v)=>setSizePrice(i,k,v)} fallbackPrice={it.price} />
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {picked && <div style={{fontSize:'12px',color:'var(--muted)',marginBottom:'10px'}}>Prefilled from the quote — edit any field before creating.</div>}
          {items.some(it=>lineAmt(it)>0) && (()=>{
            const sub=items.reduce((a,it)=>a+lineAmt(it),0);
            const mold=Number(form.mold)||0; const grand=sub+mold;
            return (
              <div className="po-draft-totals">
                <div className="pdt-row"><span>Goods subtotal</span><span className="mono">{money(sub,form.currency)}</span></div>
                {mold>0 && <div className="pdt-row"><span>Tooling / mold</span><span className="mono">{money(mold,form.currency)}</span></div>}
                <div className="pdt-grand"><span>PO total · {form.currency}</span><span className="mono">{money(grand,form.currency)}</span></div>
              </div>
            );
          })()}
          <div style={{display:"flex",gap:"10px",marginBottom:"16px",alignItems:"center",flexWrap:"wrap"}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>setShowPicker(true)}>+ Add Item</button>
            {mode==='manual' && items.some(it=>it.desc.trim()) && (
              <span title="Disabled — this action has known defects and has never completed successfully. Ask Matt." style={{display:'inline-flex'}}>
                <button className="btn btn-ghost btn-sm" style={{color:'var(--accent)',opacity:.45}} disabled onClick={saveAsProductsAndQuotes}>Save as products &amp; quotes</button>
              </span>
            )}
            {saveMsg && <div style={{fontSize:'12.5px',fontWeight:500,padding:'6px 10px',borderRadius:'7px',background:saveMsg.startsWith('error:')?'#fef2f2':'#d1fae5',color:saveMsg.startsWith('error:')?'#991b1b':'#065f46'}}>{saveMsg.startsWith('error:')?'⚠ '+saveMsg.slice(6):'✓ '+saveMsg}</div>}
          </div>
          <span className="form-section-label">Preproduction Samples</span>
          <div style={{padding:'4px 0 14px'}}>
            <label style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'13.5px',cursor:'pointer',fontFamily:'var(--sans)',textTransform:'none',letterSpacing:0,color:'var(--ink)',fontWeight:400}}>
              <input type="checkbox" checked={!!form.needs_samples} onChange={e=>f('needs_samples')(e.target.checked)} style={{width:'16px',height:'16px',accentColor:'var(--accent)'}} />
              Do we need preproduction samples for this order?
            </label>
            {form.needs_samples && (
              <>
              <div style={{marginTop:'12px'}}>
                <label>Sample types <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(select all that apply)</span></label>
                <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'6px'}}>
                  {['TOP','Model Store','Preproduction','Salesman','Photo/PR'].map(t=>{ const sel=(form.sample_type||'').split(',').map(x=>x.trim()).filter(Boolean); const on=sel.includes(t); return (
                    <button key={t} type="button" onClick={()=>{ markDirty(); const next=on?sel.filter(x=>x!==t):[...sel,t]; f('sample_type')(next.join(', ')); }} style={{padding:'7px 13px',borderRadius:'9px',border:'1px solid '+(on?'transparent':'var(--line)'),background:on?'var(--accent)':'#fff',color:on?'#fff':'var(--ink-2)',fontSize:'12.5px',fontWeight:500,cursor:'pointer'}}>{on?'✓ ':''}{t}</button>
                  ); })}
                </div>
              </div>
              <div className="form-row-2" style={{marginTop:'12px'}}>
                <div><label>Quantity needed</label><input type="number" className="form-input" value={form.sample_qty||''} onChange={e=>f('sample_qty')(e.target.value)} placeholder="e.g. 3" /></div>
                <div><label>Sample date <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(when due)</span></label><input type="date" className="form-input" value={form.sample_date||''} onChange={e=>f('sample_date')(e.target.value)} /></div>
              </div>
              </>
            )}
          </div>
          <span className="form-section-label">Fees &amp; Currency</span>
          <div className="form-row-3">
            <div><label>Mold / Tooling</label><input type="number" className="form-input" placeholder="0" value={form.mold} onChange={e=>f('mold')(e.target.value)} /></div>
            <div><label>Sample Fee</label><input type="number" className="form-input" placeholder="0" value={form.sample} onChange={e=>f('sample')(e.target.value)} /></div>
            <div><label>Currency</label><select className="form-select" value={form.currency} onChange={e=>f('currency')(e.target.value)}><option>USD</option><option>CNY</option><option>VND</option><option>EUR</option></select></div>
          </div>
          <div className="form-row"><label>Notes</label><textarea className="form-textarea" placeholder="Special instructions..." value={form.notes} onChange={e=>f('notes')(e.target.value)} /></div>
          <span className="form-section-label">Compliance & Delivery</span>
          <div className="form-row-2">
            <div><label>Shipping Method</label>
              <select className="form-select" value={form.shipping_method||''} onChange={e=>f('shipping_method')(e.target.value)}>
                <option value="">— select —</option>
                <option value="FedEx">FedEx</option>
                <option value="Sine Trading">Sine Trading</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
              <label style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'13.5px',cursor:'pointer',fontFamily:'var(--sans)',textTransform:'none',letterSpacing:0,color:'var(--ink)',fontWeight:400,marginBottom:'4px'}}>
                <input type="checkbox" checked={!!form.testing_required} onChange={e=>f('testing_required')(e.target.checked)} style={{width:'16px',height:'16px',accentColor:'#7c3aed'}} />
                Testing Required
              </label>
            </div>
          </div>
          <div className="form-row"><label>Delivery Address</label><textarea className="form-textarea" rows={3} value={form.delivery_address||''} onChange={e=>f('delivery_address')(e.target.value)} placeholder="Full delivery address for factory reference" /></div>
          </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={submit} disabled={mode==='quote'&&!picked} style={mode==='quote'&&!picked?{opacity:.5,pointerEvents:'none'}:{}}>Create Purchase Order</button>
        </div>
      </div>
    </div>
    {srchIdx>=0 && srchHits.length>0 && srchRect && typeof window!=='undefined' && createPortal(
      <div style={{position:'fixed',top:srchRect.top,left:srchRect.left,width:srchRect.w,background:'#fff',border:'1px solid #e2e8f0',borderRadius:'10px',boxShadow:'0 8px 24px rgba(0,0,0,.16)',zIndex:99999,maxHeight:'220px',overflowY:'auto'}}>
        {srchHits.map(p=>(
          <div key={p.id||p.name} style={{padding:'10px 14px',fontSize:'13px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}} onMouseDown={()=>pickProd(srchIdx,p)}>
            <span style={{fontWeight:600,color:'#0b1120'}}>{p.name}</span>
            <span style={{fontSize:'11px',color:'#94a3b8'}}>{p.sku||''}{p.recent?' recent':''}</span>
          </div>
        ))}
      </div>,
      document.body
    )}
    </>
  );
}

// ── Create Company Modal ──────────────────────────────────────────────────────
function CreateCompanyModal({ onClose, onCreated }) {
  // Plain form, every field an input or select. No click-driven setters at all.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [form, setForm] = useState({name:'',type:'client',email:'',phone:'',website:'',vendor_number:'',pallet_info:'',billing_address:'',shipping_address:'',cname:'',cemail:'',cphone:''});
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const submit = async () => {
    if (!form.name) { alert('Company name required'); return; }
    const { data: co, error } = await SB.from('companies').upsert({name:form.name,type:form.type,email:form.email||null,phone:form.phone||null,website:form.website||null,vendor_number:form.vendor_number||null,pallet_info:form.pallet_info||null,billing_address:form.billing_address||null,shipping_address:form.shipping_address||null},{onConflict:'name,type',ignoreDuplicates:false}).select().single();
    if (error) { alert('Error: '+error.message); return; }
    if (form.cname) await SB.from('contacts').insert({company_id:co.id,full_name:form.cname,email:form.cemail||null,phone:form.cphone||null,is_primary:true});
    // Mirror into Quotes directory so it appears in quote autofill
    try {
      if (form.type==='client') {
        await SBQ.from('client_contacts').insert({client:form.name,contact:form.cname||null,email:form.cemail||null,phone:form.phone||null}).select();
      } else if (form.type==='factory') {
        await SBQ.from('factory_presets').insert({factory:form.name,factory_email:form.email||null,factory_phone:form.phone||null}).select();
      }
    } catch(e) {}
    onCreated();
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box">
        <div className="modal-head"><h3>New Company</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>Company Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
            <div><label>Type</label><select className="form-select" value={form.type} onChange={e=>f('type')(e.target.value)}>{COMPANY_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Email</label><input type="email" className="form-input" value={form.email} onChange={e=>f('email')(e.target.value)} /></div>
            <div><label>Phone</label><input className="form-input" value={form.phone} onChange={e=>f('phone')(e.target.value)} /></div>
          </div>
          <div className="form-row"><label>Website</label><input className="form-input" value={form.website} onChange={e=>f('website')(e.target.value)} placeholder="https://" /></div>
          <div className="form-row"><label>Billing Address</label><textarea className="form-input" rows={3} value={form.billing_address} onChange={e=>f('billing_address')(e.target.value)} placeholder="Street, city, state / province, postal code, country" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
          <div className="form-row"><label>Shipping Address <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(prefills the ship-to on new orders)</span></label><textarea className="form-input" rows={3} value={form.shipping_address} onChange={e=>f('shipping_address')(e.target.value)} placeholder="Street, city, state / province, postal code, country" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
          {form.type==='client' && (
            <div className="form-row-2">
              <div><label>Vendor # <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(internal)</span></label><input className="form-input" value={form.vendor_number} onChange={e=>f('vendor_number')(e.target.value)} /></div>
              <div><label>Pallet info</label><input className="form-input" value={form.pallet_info} onChange={e=>f('pallet_info')(e.target.value)} placeholder="e.g. 48x40 GMA" /></div>
            </div>
          )}
          <span className="form-section-label">Primary Contact</span>
          <div className="form-row-2">
            <div><label>Full Name</label><input className="form-input" value={form.cname} onChange={e=>f('cname')(e.target.value)} /></div>
            <div><label>Email</label><input type="email" className="form-input" value={form.cemail} onChange={e=>f('cemail')(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit}>Save Company</button></div>
      </div>
    </div>
  );
}

// ── Create Shipment Modal ─────────────────────────────────────────────────────
function CreateShipmentModal({ onClose, onCreated }) {
  // Plain form. The shipment number is pre-minted from the clock into an input,
  // which the baseline absorbs, so an untouched open still closes silently.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [companies, setCompanies] = useState([]);
  const [pos, setPos] = useState([]);
  const [form, setForm] = useState({
    number: `SHP-${Date.now().toString(36).slice(-5).toUpperCase()}`,
    client:'', carrier:'', bol:'', etd:'', eta:'', status:'created', inco:'', poId:''
  });
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  useEffect(()=>{
    SB.from('companies').select('id,name,type').order('name').then(({data})=>setCompanies(data||[]));
    SB.from('purchase_orders').select('id,order_number').order('created_at',{ascending:false}).limit(200).then(({data})=>setPos(data||[]));
  },[]);
  const clients  = companies.filter(c=>['client','brand','customer'].includes(c.type));
  const carriers = companies.filter(c=>['carrier','freight_forwarder'].includes(c.type));
  const STATUSES = ['created','in_transit','at_origin_port','at_transshipment','at_destination_port','customs','out_for_delivery','delivered','delayed','exception','cancelled'];
  const submit = async () => {
    if (!form.number) { alert('Shipment number required'); return; }
    const { data: ship, error } = await SB.from('shipments').insert({
      shipment_number: form.number,
      client_company_id: form.client || null,
      carrier_company_id: form.carrier || null,
      bill_of_lading: form.bol || null,
      estimated_departure: form.etd ? new Date(form.etd+'T12:00:00').toISOString() : null,
      estimated_arrival:   form.eta ? new Date(form.eta+'T12:00:00').toISOString() : null,
      status: form.status,
    }).select('id').single();
    if (error) { alert('Error: '+error.message); return; }
    if (form.poId) await SB.from('shipment_pos').insert({ shipment_id: ship.id, purchase_order_id: form.poId });
    onCreated();
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box">
        <div className="modal-head"><h3>New Shipment</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>Shipment # *</label><input className="form-input" value={form.number} onChange={e=>f('number')(e.target.value)} /></div>
            <div><label>Status</label><select className="form-select" value={form.status} onChange={e=>f('status')(e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Client</label><select className="form-select" value={form.client} onChange={e=>f('client')(e.target.value)}><option value="">—</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label>Carrier / Forwarder</label><select className="form-select" value={form.carrier} onChange={e=>f('carrier')(e.target.value)}><option value="">—</option>{carriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row"><label>Bill of Lading</label><input className="form-input" value={form.bol} onChange={e=>f('bol')(e.target.value)} /></div>
          <div className="form-row-2">
            <div><label>ETD</label><input type="date" className="form-input" value={form.etd} onChange={e=>f('etd')(e.target.value)} /></div>
            <div><label>ETA</label><input type="date" className="form-input" value={form.eta} onChange={e=>f('eta')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Incoterm</label><input className="form-input" value={form.inco} onChange={e=>f('inco')(e.target.value)} placeholder="FOB, DDP…" /></div>
            <div><label>Link to PO (optional)</label><select className="form-select" value={form.poId} onChange={e=>f('poId')(e.target.value)}><option value="">None</option>{pos.map(p=><option key={p.id} value={p.id}>{p.order_number||p.id.slice(0,8)}</option>)}</select></div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit}>Save Shipment</button></div>
      </div>
    </div>
  );
}

// ── PO Document Builder ───────────────────────────────────────────────────────
function buildPODoc(d, opts={}) {
  const pallet = opts.pallet || d.pallet_info || '';
  const clientName = opts.clientName || d.client_name || '';
  const testingRequired = opts.testingRequired || d.testing_required || false;
  const deliveryAddress = opts.deliveryAddress || d.delivery_address || '';
  const shippingMethod = opts.shippingMethod || d.shipping_method || '';
  const clientNotes = opts.clientNotes || '';
  const cancelDate = opts.cancelDate || null;
  const needsSamples = opts.needsSamples || false;
  const sampleType = opts.sampleType || '';
  const sampleQty = opts.sampleQty || null;
  const sampleDate = opts.sampleDate || null;
  const artImages = opts.artImages || [];
  const otherFiles = opts.otherFiles || [];
  const t = d.totals || {};
  const cur = d.currency || 'USD';
  const m = (n,c) => n==null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:c||cur}).format(n);
  const fd = s => { if(!s) return '—'; const dt=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(dt)?'—':dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
  const fn = n => n==null ? '—' : new Intl.NumberFormat('en-US').format(n);

  const lines = (d.lines||[]).map((l, i) => {
    const ci = l.ci_value != null ? l.ci_value : (l.ci != null ? l.ci : null);
    const carton = l.carton_info || l.carton || '';
    const vpn = l.vpn || '';
    const masterSku = l.master_sku || l.masterSku || '';
    const packSku = l.pack_sku || l.packSku || '';
    const babySku = l.baby_sku || l.babySku || '';
    const retailPrice = l.retail_price != null ? l.retail_price : (l.retailPrice != null ? l.retailPrice : null);
    const size = l.size || '';
    const bg = i % 2 === 0 ? '#fff' : '#f9fafb';
    return '<tr style="background:'+bg+'">'
      +'<td style="padding:16px 18px;vertical-align:top;border-bottom:1px solid #e5e7eb;">'
        +'<div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:6px;">'+(l.description||'—')+'</div>'
        +(size?'<div style="margin-bottom:6px;"><span style="display:inline-block;background:#eef1f6;border:1px solid #e5e7eb;border-radius:5px;padding:3px 9px;font-size:13px;font-weight:700;color:#0c1322;letter-spacing:.04em;">Size '+size+'</span></div>':'')
        +(carton?'<div style="font-size:12px;color:#6b7280;margin-bottom:3px;">📦 '+carton+'</div>':'')
        +(vpn?'<div style="font-size:12px;color:#6b7280;font-family:monospace;">VPN# '+vpn+'</div>':'')
        +(masterSku?'<div style="font-size:12px;color:#6b7280;font-family:monospace;">Master: '+masterSku+'</div>':'')
        +(packSku?'<div style="font-size:12px;color:#6b7280;font-family:monospace;">Pack: '+packSku+'</div>':'')
        +(babySku?'<div style="font-size:12px;color:#6b7280;font-family:monospace;">Baby: '+babySku+'</div>':'')
        +(retailPrice!=null?'<div style="font-size:12px;color:#059669;font-weight:600;margin-top:4px;">Retail: '+m(retailPrice,cur)+'</div>':'')
      +'</td>'
      +'<td style="padding:16px 14px;text-align:center;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:700;color:#0f172a;font-family:monospace;">'+fn(l.quantity)+'</td>'
      +'<td style="padding:16px 14px;text-align:right;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;font-family:monospace;">'+(ci!=null?m(ci,cur):'—')+'</td>'
      +'<td style="padding:16px 14px;text-align:right;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;font-family:monospace;">'+m(l.unit_price,cur)+'</td>'
      +'<td style="padding:16px 18px;text-align:right;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:15px;font-weight:700;color:#0f172a;font-family:monospace;">'+m(l.line_amount,cur)+'</td>'
      +'</tr>';
  }).join('');

  const termBoxes = [
    ['Order Date', fd(d.order_date)],
    ['CRD', fd(d.required_ship_date||d.requested_ship_date)],
    cancelDate ? ['Cancel Date', fd(cancelDate)] : null,
    ['Incoterm', d.incoterm||'—'],
    ['Payment Terms', d.payment_terms||'—'],
    shippingMethod ? ['Shipping Method', shippingMethod] : null,
    testingRequired ? ['Testing', 'REQUIRED'] : null,
    needsSamples ? ['Samples', (sampleType||'Required')+(sampleQty?' · '+sampleQty+' pcs':'')] : null,
    (needsSamples && sampleDate) ? ['Sample Due', fd(sampleDate)] : null,
  ].filter(Boolean).map(([l,v]) =>
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;">'
    +'<div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">'+l+'</div>'
    +'<div style="font-size:15px;font-weight:600;color:'+(l==='Testing'?'#7c3aed':'#0f172a')+';">'+v+'</div>'
    +'</div>'
  ).join('');

  const subtotal = t.subtotal != null ? t.subtotal : (d.lines||[]).reduce((a,l)=>a+(Number(l.line_amount)||0),0);
  const grandTotal = t.grand_total != null ? t.grand_total : subtotal + (Number(t.mold_fee)||0);

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
+'<title>Purchase Order — '+(d.client_po||d.po_number||'')+'</title>'
+'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">'
+'<style>'
+'*{box-sizing:border-box;margin:0;padding:0;}'
+'html,body{font-family:\'Inter\',system-ui,sans-serif;font-size:14px;color:#0f172a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
+'.page{max-width:820px;margin:0 auto;padding:48px;}'
+'@media print{@page{size:A4;margin:20mm;}.page{padding:0;max-width:none;}}'
+'</style>'
+'</head><body><div class="page">'

// ── Header bar ──
+'<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:28px;border-bottom:3px solid #0c1322;margin-bottom:32px;">'
  +'<div>'
    +'<div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">King Universal Inc.</div>'
    +'<div style="font-size:36px;font-weight:800;color:#0c1322;letter-spacing:-.02em;line-height:1;">Purchase Order</div>'
  +'</div>'
  +'<div style="text-align:right;">'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">PO Reference</div>'
    +'<div style="font-size:26px;font-weight:700;color:#0c1322;font-family:\'JetBrains Mono\',monospace;letter-spacing:-.01em;">'+(d.client_po||d.po_number||'—')+'</div>'
    +'<div style="font-size:12px;color:#94a3b8;margin-top:4px;">Issued '+fd(d.order_date)+'</div>'
  +'</div>'
+'</div>'

// ── Client banner ──
+(clientName?'<div style="background:linear-gradient(135deg,#0c1322 0%,#1e3a5f 100%);border-radius:12px;padding:18px 24px;margin-bottom:28px;display:flex;align-items:center;justify-content:space-between;">'
  +'<div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:4px;">Prepared For</div>'
    +'<div style="font-size:20px;font-weight:700;color:#fff;">'+clientName+'</div>'
  +'</div>'
  +(d.client_po?'<div style="background:rgba(255,255,255,.12);border-radius:8px;padding:10px 16px;text-align:center;">'
    +'<div style="font-size:10px;color:rgba(255,255,255,.5);margin-bottom:2px;">CLIENT PO</div>'
    +'<div style="font-size:16px;font-weight:700;color:#fff;font-family:\'JetBrains Mono\',monospace;">'+d.client_po+'</div>'
    +'</div>':'')
+'</div>':'')

// ── Parties ──
+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px;">'
  +'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;">'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">Supplier / Factory</div>'
    +'<div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px;">'+(d.supplier?.name||'—')+'</div>'
    +(d.supplier?.email?'<div style="font-size:13px;color:#64748b;">'+d.supplier.email+'</div>':'')
  +'</div>'
  +'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;">'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">Ship To</div>'
    +(deliveryAddress?'<div style="font-size:14px;color:#0f172a;line-height:1.7;">'+deliveryAddress.replace(/\n/g,'<br>')+'</div>':'<div style="font-size:13px;color:#94a3b8;">As directed</div>')
  +'</div>'
+'</div>'

// ── Terms boxes ──
+'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:32px;">'
+termBoxes
+'</div>'

// ── Line items table ──
+'<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:28px;">'
  +'<div style="background:#0c1322;padding:14px 18px;display:grid;grid-template-columns:1fr 80px 110px 110px 120px;gap:8px;">'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);">Description</div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);text-align:center;">Qty</div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);text-align:right;">CI Value</div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);text-align:right;">Unit Cost</div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);text-align:right;">Amount</div>'
  +'</div>'
  +'<table style="width:100%;border-collapse:collapse;"><tbody>'+lines+'</tbody></table>'
+'</div>'

// ── Client compliance notes (printed on every PO for this client) ──
+(clientNotes?'<div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:10px;padding:16px 20px;margin-bottom:28px;">'
  +'<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#b45309;margin-bottom:8px;">Client Requirements — '+(clientName||'')+'</div>'
  +'<div style="font-size:13px;color:#451a03;line-height:1.7;white-space:pre-line;">'+clientNotes+'</div>'
+'</div>':'')

// ── Totals + notes ──
+'<div style="display:grid;grid-template-columns:1fr 300px;gap:32px;margin-bottom:40px;">'
  +'<div>'
    +(pallet?'<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Palletization</div><div style="font-size:13.5px;color:#374151;line-height:1.6;">'+pallet+'</div></div>':'')
    +(d.notes?'<div><div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Notes</div><div style="font-size:13.5px;color:#374151;line-height:1.6;">'+d.notes+'</div></div>':'')
  +'</div>'
  +'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;">'
    +'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;"><span style="font-size:14px;color:#64748b;">Subtotal</span><span style="font-size:14px;font-family:\'JetBrains Mono\',monospace;color:#374151;">'+m(subtotal,cur)+'</span></div>'
    +(t.mold_fee?'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;"><span style="font-size:14px;color:#64748b;">Tooling / Mold</span><span style="font-size:14px;font-family:\'JetBrains Mono\',monospace;color:#374151;">'+m(t.mold_fee,cur)+'</span></div>':'')
    +'<div style="display:flex;justify-content:space-between;padding:14px 0 0;margin-top:4px;"><span style="font-size:17px;font-weight:700;color:#0f172a;">Total '+cur+'</span><span style="font-size:20px;font-weight:800;color:#0c1322;font-family:\'JetBrains Mono\',monospace;">'+m(grandTotal,cur)+'</span></div>'
    +(t.deposit_amount?'<div style="display:flex;justify-content:space-between;margin-top:8px;padding:10px 12px;background:#eff6ff;border-radius:8px;"><span style="font-size:13px;color:#3730a3;">'+( d.deposit_percent||'')+'% Deposit Due</span><span style="font-size:13px;font-weight:600;color:#3730a3;font-family:\'JetBrains Mono\',monospace;">'+m(t.deposit_amount,cur)+'</span></div>':'')
  +'</div>'
+'</div>'

// ── Signature block ──
+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;padding-top:32px;border-top:2px solid #e5e7eb;">'
  +'<div><div style="border-top:2px solid #0c1322;padding-top:10px;font-size:12px;font-weight:600;color:#64748b;letter-spacing:.06em;text-transform:uppercase;">Authorized — King Universal Inc.</div><div style="margin-top:40px;border-top:1px solid #d1d5db;padding-top:8px;font-size:11px;color:#94a3b8;">Signature / Date</div></div>'
  +'<div><div style="border-top:2px solid #0c1322;padding-top:10px;font-size:12px;font-weight:600;color:#64748b;letter-spacing:.06em;text-transform:uppercase;">Accepted — Supplier</div><div style="margin-top:40px;border-top:1px solid #d1d5db;padding-top:8px;font-size:11px;color:#94a3b8;">Signature / Date</div></div>'
+'</div>'

// ── Attached art (images embedded on their own pages) ──
+(artImages.length ? artImages.map(function(img){
  return '<div style="page-break-before:always;padding-top:24px;">'
    +'<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Attached Artwork — PO '+(d.client_po||d.po_number||'')+'</div>'
    +'<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:14px;">'+img.name+'</div>'
    +'<img src="'+img.url+'" style="max-width:100%;max-height:900px;border:1px solid #e5e7eb;border-radius:8px;" />'
    +'</div>';
}).join('') : '')

// ── Other attached files (PDFs/AI) listed — they accompany the PO separately ──
+(otherFiles.length ? '<div style="page-break-before:always;padding-top:24px;">'
  +'<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px;">Attached Files</div>'
  +'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;">'
  +'<div style="font-size:13px;color:#64748b;margin-bottom:12px;">The following files are attached to this purchase order and provided alongside this document:</div>'
  +otherFiles.map(function(n){ return '<div style="font-size:14px;color:#0f172a;padding:7px 0;border-bottom:1px solid #eef1f6;display:flex;align-items:center;gap:8px;"><span style="font-size:11px;font-weight:700;color:#3551c4;background:#e7edfd;padding:2px 7px;border-radius:5px;text-transform:uppercase;">'+((n.split('.').pop()||'file')).toLowerCase()+'</span>'+n+'</div>'; }).join('')
  +'</div></div>' : '')

+'</div></body></html>';
}

// ── Freight Quote helpers ─────────────────────────────────────────────────────
// Parse free-text carton_info like "12 pcs/ctn, 60×40×30 cm, 11 kg" into structured hints.
function parseCartonInfo(txt) {
  const out = { upc:null, cbmPer:null, weight:null };
  if (!txt) return out;
  const t = String(txt).toLowerCase().replace(/×/g,'x');
  const upc = t.match(/(\d+)\s*(?:pcs?|units?|pc)\s*\/?\s*(?:ctn|carton|box)/);
  if (upc) out.upc = Number(upc[1]);
  const dims = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/);
  if (dims) {
    let [l,w,h] = [Number(dims[1]),Number(dims[2]),Number(dims[3])];
    const unit = dims[4]||'cm';
    let div = 1000000; // cm3 -> m3
    if (unit==='mm') div = 1000000000;
    if (unit==='m')  div = 1;
    out.cbmPer = (l*w*h)/div;
  }
  const wt = t.match(/(\d+(?:\.\d+)?)\s*kg/);
  if (wt) out.weight = Number(wt[1]);
  return out;
}
// Usable CBM capacity per container type (practical loadable volume, not theoretical max)
const CONTAINER_TYPES = [
  { key:'20GP',  label:"20' Standard",     cbm:32 },
  { key:'40GP',  label:"40' Standard",     cbm:58 },
  { key:'40HQ',  label:"40' High-Cube",    cbm:68 },
  { key:'45HQ',  label:"45' High-Cube",    cbm:83 },
];
const CONTAINER_MAP = Object.fromEntries(CONTAINER_TYPES.map(c=>[c.key,c]));
const CBM_MAX_40HQ = 68; // legacy default fallback

// Pass `data` to edit that row, omit it to create — the same shape CreateProductModal
// and MaterialModal use.
//
// Until now this was create-only: no data prop, insert on both paths, and nothing on
// the freight quote card reopened it. A quote could be printed but never corrected,
// which is what Kristy hit — updated_at equalled created_at on all seven rows because
// no UPDATE had ever run against this table.
function ShipmentQuoteModal({ data, onClose, onSaved }) {
  // markDirty for the container-type chips, and ONLY those. form.containerType
  // is rendered as button highlighting and as derived text (capacity, container
  // count, utilization) -- I traced all ten of its uses and it is never the
  // value of an input, select or textarea, so changing it moves nothing the
  // snapshot can see. applyPO, applyProduct, autoFillCartons, addLine and
  // rmLine all rewrite the line-item inputs and need no help.
  const { ref: cardRef, guardedClose, markDirty } = useDirtyGuard(onClose);
  const editing = !!(data && data.id);
  const [mode, setMode] = useState('po'); // 'po' | 'product'
  const [picked, setPicked] = useState(null); // {kind, id, label, sub}
  const [companies, setCompanies] = useState([]);
  const [pos, setPos] = useState([]);
  const [products, setProducts] = useState([]);
  const [poSearch, setPoSearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  // Lazy initialisers: the create branch mints a quote number from the clock, and
  // computing it on every render to throw it away invites the two paths drifting.
  const [form, setForm] = useState(() => editing ? {
    number: data.quote_number||'',
    client: data.client_company_id||'', forwarder: data.forwarder_company_id||'',
    poId: data.po_id||'',
    origin: data.origin||'', destination: data.destination||'',
    incoterm: data.incoterm||'FOB',
    // A `date` column arrives as 'YYYY-MM-DD'; the input wants exactly that, and
    // slicing guards a row that ever holds a timestamp.
    ready: data.ready_date ? String(data.ready_date).slice(0,10) : '',
    notes: data.notes||'', containerType: data.container_type||'40HQ',
  } : {
    number: newQuoteNumber(),
    client:'', forwarder:'', poId:'', origin:'', destination:'', incoterm:'FOB', ready:'', notes:'', containerType:'40HQ'
  });
  // line_items is jsonb holding numbers; every box in this form is a string. The stored
  // shape uses cbm_per where the form uses cbmPer, and carries pieces and cbm_total,
  // which are derived on save and so are not read back.
  const [lines, setLines] = useState(() => {
    const stored = editing && Array.isArray(data.line_items) ? data.line_items : [];
    if (!stored.length) return [{ desc:'', upc:'', cartons:'', cbmPer:'', weight:'' }];
    const s = v => (v === null || v === undefined ? '' : String(v));
    return stored.map(l=>({ desc:l.desc||'', upc:s(l.upc), cartons:s(l.cartons), cbmPer:s(l.cbm_per), weight:s(l.weight) }));
  });
  const [saving, setSaving] = useState(false);
  const f = k => v => setForm(prev=>({...prev,[k]:v}));

  useEffect(()=>{
    SB.from('companies').select('id,name,type').order('name').then(({data})=>setCompanies(data||[]));
    // POs — flat query + JS stitch (embedded joins can null the whole result)
    (async()=>{
      let { data, error } = await SB.from('purchase_orders').select('id,order_number,client_po_number,requested_ship_date,incoterm,client_company_id,source_quote_id').order('created_at',{ascending:false}).limit(300);
      if (error || !data) {
        const retry = await SB.from('purchase_orders').select('id,order_number,client_po_number,client_company_id').order('created_at',{ascending:false}).limit(300);
        data = retry.data || [];
      }
      const { data: comps } = await SB.from('companies').select('id,name');
      const cmap = {}; (comps||[]).forEach(c=>{ cmap[c.id]=c.name; });
      setPos((data||[]).map(p=>({ ...p, client:{ id:p.client_company_id, name:cmap[p.client_company_id]||'' } })));
    })();
    // "Products" in KUI = quote records (same source as the Products tab), which carry carton/CBM data
    (async()=>{
      const { data } = await SBQ.from('quotes').select('*').order('created_at',{ascending:false});
      setProducts(data||[]);
    })();
  },[]);
  const clients  = companies.filter(c=>['client','brand','customer'].includes(c.type));
  const forwarders = companies.filter(c=>['carrier','freight_forwarder'].includes(c.type));

  const setLine = (i,k) => e => setLines(prev=>prev.map((l,j)=>j===i?{...l,[k]:e.target.value}:l));
  const addLine = () => setLines(prev=>[...prev,{ desc:'', upc:'', cartons:'', cbmPer:'', weight:'' }]);
  const rmLine = i => setLines(prev=>prev.filter((_,j)=>j!==i));

  // Fill the selected container to capacity. Single line → max cartons that fit under the CBM cap.
  // Multiple lines → scale up proportionally to the current mix until the container is full.
  const autoFillCartons = () => {
    const cap = (CONTAINER_MAP[form.containerType]||CONTAINER_MAP['40HQ']).cbm;
    const withCbm = lines.filter(l=>(Number(l.cbmPer)||0)>0);
    if (!withCbm.length) { alert('Enter CBM per carton first — then Auto-fill can calculate how many fit.'); return; }
    if (withCbm.length===1 && lines.length===1) {
      const per = Number(lines[0].cbmPer)||0;
      const fit = Math.floor(cap / per);
      setLines([{ ...lines[0], cartons:String(fit) }]);
      return;
    }
    // proportional scale on the existing carton mix
    const baseCbm = lines.reduce((a,l)=>a+((Number(l.cartons)||0)*(Number(l.cbmPer)||0)),0);
    if (baseCbm<=0) { alert('Enter carton counts on at least one line, then Auto-fill scales the mix to a full container.'); return; }
    const factor = cap / baseCbm;
    let next = lines.map(l=>{
      const c=Number(l.cartons)||0;
      return { ...l, cartons: c>0 ? String(Math.floor(c*factor)) : l.cartons };
    });
    // trim if rounding pushed us over the cap
    let total = next.reduce((a,l)=>a+((Number(l.cartons)||0)*(Number(l.cbmPer)||0)),0);
    while (total > cap) {
      const idx = next.reduce((best,l,j)=>{ const cb=(Number(l.cbmPer)||0); return (Number(l.cartons)||0)>0 && (best<0 || cb>(Number(next[best].cbmPer)||0)) ? j : best; }, -1);
      if (idx<0) break;
      next[idx] = { ...next[idx], cartons:String(Math.max(0,(Number(next[idx].cartons)||0)-1)) };
      total = next.reduce((a,l)=>a+((Number(l.cartons)||0)*(Number(l.cbmPer)||0)),0);
    }
    setLines(next);
  };

  // Carton/CBM facts from a quote record
  const cartonFromQuote = (q) => {
    if (!q) return null;
    const L=Number(q.carton_l)||0, W=Number(q.carton_w)||0, H=Number(q.carton_h)||0;
    const cbm = (L>0&&W>0&&H>0) ? (L*W*H)/1000000 : 0;
    return { upc:Number(q.units_per_carton)||0, cbmPer:cbm, weight:Number(q.carton_weight)||0 };
  };
  // Best-effort match of a PO line to a quote record
  const matchQuote = (quotes, { desc, sku, sourceQuoteId }) => {
    if (sourceQuoteId) { const direct = quotes.find(q=>String(q.id)===String(sourceQuoteId)); if (direct) return direct; }
    const d=(desc||'').trim().toLowerCase(), s=(sku||'').trim().toLowerCase();
    if (s) { const bySku = quotes.find(q=>(q.sku||'').trim().toLowerCase()===s); if (bySku) return bySku; }
    if (d) {
      const exact = quotes.find(q=>(q.product||'').trim().toLowerCase()===d);
      if (exact) return exact;
      const partial = quotes.find(q=>{ const p=(q.product||'').trim().toLowerCase(); return p && (p.includes(d)||d.includes(p)); });
      if (partial) return partial;
    }
    return null;
  };

  // ── Generate from a PO — autofill everything ──
  const applyPO = async (po) => {
    const clientId = po.client?.id || '';
    setForm(prev=>({ ...prev, poId:po.id, client:clientId,
      incoterm: po.incoterm || prev.incoterm,
      ready: po.requested_ship_date ? String(po.requested_ship_date).slice(0,10) : '' }));
    let { data } = await SB.from('purchase_order_items').select('description,quantity,carton_info,master_sku,products(name,sku)').eq('purchase_order_id',po.id);
    if (!data) {
      const retry = await SB.from('purchase_order_items').select('description,quantity,carton_info,master_sku').eq('purchase_order_id',po.id);
      data = retry.data;
    }
    const quoteList = products; // quote records already loaded
    if (data && data.length) {
      setLines(data.map(it=>{
        const desc = it.description || it.products?.name || '';
        const sku  = it.master_sku || it.products?.sku || '';
        // first try the quote record for structured carton data, else parse carton_info text
        const q = matchQuote(quoteList, { desc, sku, sourceQuoteId: po.source_quote_id });
        const fromQ = cartonFromQuote(q);
        const hint = parseCartonInfo(it.carton_info);
        const upc    = (fromQ&&fromQ.upc)    || hint.upc    || 0;
        const cbmPer = (fromQ&&fromQ.cbmPer) || hint.cbmPer || 0;
        const weight = (fromQ&&fromQ.weight) || hint.weight || 0;
        const qty = Number(it.quantity)||0;
        const cartons = upc>0 ? Math.ceil(qty/upc) : '';
        return { desc,
          upc: upc>0?String(upc):'',
          cartons: cartons!==''?String(cartons):'',
          cbmPer: cbmPer>0?cbmPer.toFixed(4):'',
          weight: weight>0?String(weight):'' };
      }));
    } else {
      setLines([{ desc:'', upc:'', cartons:'', cbmPer:'', weight:'' }]);
    }
    setPicked({ kind:'po', id:po.id, label:po.client_po_number||po.order_number||'PO', sub:po.client?.name||'' });
  };

  // ── Generate from a product (quote record) — single-product container ──
  const applyProduct = (q) => {
    const c = cartonFromQuote(q);
    // match the quote's client name to a company record so the client autofills
    const qName = (q.client||'').trim().toLowerCase();
    let matchId = '';
    if (qName) {
      const exact = companies.find(co=>(co.name||'').trim().toLowerCase()===qName);
      const partial = exact || companies.find(co=>{ const n=(co.name||'').trim().toLowerCase(); return n && (n.includes(qName)||qName.includes(n)); });
      if (partial) matchId = partial.id;
    }
    setForm(prev=>({ ...prev, poId:'', client: matchId || prev.client }));
    setLines([{ desc: q.product || q.sku || '',
      upc: c&&c.upc>0 ? String(c.upc) : '',
      cartons:'',
      cbmPer: c&&c.cbmPer>0 ? c.cbmPer.toFixed(4) : '',
      weight: c&&c.weight>0 ? String(c.weight) : '' }]);
    setPicked({ kind:'product', id:q.id, label:q.product||q.sku||'Product', sub:[q.client,q.sku].filter(Boolean).join(' \u00b7 ') });
  };

  const resetPick = () => { setPicked(null); setForm(prev=>({...prev,poId:''})); setLines([{ desc:'', upc:'', cartons:'', cbmPer:'', weight:'' }]); };

  const filteredPOs = pos.filter(p=>{ const q=poSearch.trim().toLowerCase(); if(!q) return true; return (p.client_po_number||'').toLowerCase().includes(q)||(p.order_number||'').toLowerCase().includes(q)||(p.client?.name||'').toLowerCase().includes(q); });
  const filteredProducts = products.filter(p=>{ const q=prodSearch.trim().toLowerCase(); if(!q) return true; return ((p.product||'')+' '+(p.client||'')+' '+(p.sku||'')+' '+(p.factory||'')).toLowerCase().includes(q); });

  // totals + container math
  const calc = lines.reduce((acc,l)=>{
    const cartons = Number(l.cartons)||0, cbmPer = Number(l.cbmPer)||0, wt = Number(l.weight)||0, upc = Number(l.upc)||0;
    acc.cartons += cartons; acc.cbm += cartons*cbmPer; acc.weight += cartons*wt; acc.pieces += cartons*upc; return acc;
  }, { cartons:0, cbm:0, weight:0, pieces:0 });
  const capCbm = (CONTAINER_MAP[form.containerType]||CONTAINER_MAP['40HQ']).cbm;
  const containers = calc.cbm>0 ? Math.ceil(calc.cbm / capCbm) : 0;
  const utilization = containers>0 ? (calc.cbm/(containers*capCbm))*100 : 0;

  const buildPayload = (status) => ({
    quote_number: form.number,
    client_company_id: form.client||null,
    forwarder_company_id: form.forwarder||null,
    po_id: form.poId||null,
    origin: form.origin||null, destination: form.destination||null,
    incoterm: form.incoterm||null, ready_date: form.ready||null,
    container_type:form.containerType, cbm_max:capCbm,
    total_cartons: calc.cartons, total_cbm: Number(calc.cbm.toFixed(3)),
    total_weight_kg: Number(calc.weight.toFixed(2)),
    containers_needed: containers, utilization_pct: Number(utilization.toFixed(1)),
    line_items: lines.filter(l=>l.desc||l.cartons).map(l=>({ desc:l.desc, upc:Number(l.upc)||0, cartons:Number(l.cartons)||0, pieces:(Number(l.cartons)||0)*(Number(l.upc)||0), cbm_per:Number(l.cbmPer)||0, cbm_total:Number(((Number(l.cartons)||0)*(Number(l.cbmPer)||0)).toFixed(3)), weight:Number(l.weight)||0 })),
    notes: form.notes||null, status,
    sent_at: status==='sent'? new Date().toISOString() : null,
  });

  // status and sent_at are dropped from the edit payload rather than sent. PostgREST
  // writes only the keys given, so omitting them leaves both alone -- correcting a
  // carton count must not restamp when the quote went out, nor flip a sent quote back
  // to draft. Same reasoning as CreateProductModal omitting category_id on edit.
  //
  // updated_at is set explicitly because vessl.shipment_quotes has NO trigger: the
  // column's default now() fires on INSERT only. Leaving it out would keep the column
  // claiming the row had never been touched, which is exactly the signal that proved
  // no edit had ever run here.
  const editPayload = () => {
    const { status, sent_at, ...rest } = buildPayload('draft');
    return { ...rest, updated_at: new Date().toISOString() };
  };
  const save = async (status) => {
    if (!form.client) { alert('Pick a client'); return; }
    setSaving(true);
    const { error } = editing
      ? await SB.from('shipment_quotes').update(editPayload()).eq('id', data.id)
      : await SB.from('shipment_quotes').insert(buildPayload(status));
    setSaving(false);
    // Checked, and the modal stays open on failure so the entry is not lost.
    if (error) { alert('Error: '+error.message); return; }
    onSaved();
  };
  const generate = async () => {
    if (!form.client) { alert('Pick a client'); return; }
    const payload = buildPayload('sent');
    setSaving(true);
    const { data, error } = await SB.from('shipment_quotes').insert(payload).select('id').single();
    setSaving(false);
    if (error) { alert('Error: '+error.message); return; }
    const clientName = clients.find(c=>c.id===form.client)?.name || '';
    const forwarderName = forwarders.find(c=>c.id===form.forwarder)?.name || '';
    openFreightSheet(payload, clientName, forwarderName);
    onSaved();
  };

  const inputS = {width:'100%',border:'1px solid #E5E7EB',borderRadius:'9px',padding:'9px 11px',fontSize:'13.5px',outline:'none',fontFamily:'inherit',boxSizing:'border-box'};
  const lblS = {display:'block',fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'5px'};

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box modal-lg">
        <div className="modal-head"><h3>{editing?'Edit Freight Quote':'New Freight Quote'}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">

          {/* mode toggle — identical pattern to New PO. Hidden on edit along with both
              pickers: "generate from" is how a quote is SOURCED, and re-sourcing an
              existing one would overwrite the cargo lines with the PO's, discarding
              whatever was corrected by hand since. Editing works on the row as saved. */}
          {!editing && (
          <div className="qp-toggle">
            <button className={mode==='po'?'on':''} onClick={()=>{setMode('po');resetPick();}}>Generate from PO</button>
            <button className={mode==='product'?'on':''} onClick={()=>{setMode('product');resetPick();}}>Generate from Product</button>
          </div>
          )}

          {/* selected banner */}
          {picked && (
            <div className="qp-banner">
              <span><b>{picked.label}</b>{picked.sub?' \u00b7 '+picked.sub:''}{picked.kind==='product'?' \u00b7 single-product container':''}</span>
              <button className="x" onClick={resetPick}>Change</button>
            </div>
          )}

          {/* PO PICKER */}
          {mode==='po' && !picked && !editing && (
            <>
              <div className="qp-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input data-noguard placeholder="Search POs — number, client…" value={poSearch} onChange={e=>setPoSearch(e.target.value)} autoFocus />
              </div>
              <div className="qp-list">
                {filteredPOs.length===0 && <div className="empty" style={{padding:'40px 20px'}}><p>No POs match.</p></div>}
                {filteredPOs.map(p=>(
                  <button key={p.id} className="qp-card" onClick={()=>applyPO(p)}>
                    <span className="qp-avatar" style={{background:companyColor(p.client?.name||''),color:'#fff'}}>{initials(p.client?.name||'?')}</span>
                    <span className="qp-meta">
                      <div className="qp-prod">{p.client_po_number||p.order_number||'PO'}</div>
                      <div className="qp-sub">{p.client?.name||'—'}{p.requested_ship_date?' · CRD '+String(p.requested_ship_date).slice(0,10):''}</div>
                    </span>
                    <span className="qp-right"><div className="qp-tiers">Select →</div></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* PRODUCT PICKER */}
          {mode==='product' && !picked && !editing && (
            <>
              <div className="qp-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input data-noguard placeholder="Search products — name, SKU…" value={prodSearch} onChange={e=>setProdSearch(e.target.value)} autoFocus />
              </div>
              <div className="qp-list">
                {filteredProducts.length===0 && <div className="empty" style={{padding:'40px 20px'}}><p>No products match.</p></div>}
                {filteredProducts.map(p=>(
                  <button key={p.id} className="qp-card" onClick={()=>applyProduct(p)}>
                    <span className="qp-avatar" style={{background:companyColor(p.client||p.product||''),color:'#fff'}}>{initials(p.client||p.product||'?')}</span>
                    <span className="qp-meta">
                      <div className="qp-prod">{p.product||'Untitled product'}</div>
                      <div className="qp-sub">{p.client||'—'}{p.factory?' \u00b7 '+p.factory:''}{p.sku?' \u00b7 '+p.sku:''}</div>
                    </span>
                    <span className="qp-right"><div className="qp-tiers">{(Number(p.carton_l)>0)?'carton data ✓':'no carton data'}</div></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* SHARED SHEET FORM — only after a PO or product is picked */}
          {(picked || editing) && (
          <>
          <div className="form-row-2">
            {/* Read-only on edit, the same treatment the eFiling and CPSC Rules blocks
                get in Edit Product: shown, not offered. On create nobody holds the
                number yet, so typing over it costs nothing. Once the quote has been
                RFQ'd it is the identifier three forwarders are quoting against, and
                quote_number has NO unique constraint — nothing anywhere would catch a
                collision or a silent renumbering. */}
            <div>
              <label style={lblS}>Quote #{editing && <span style={{textTransform:'none',letterSpacing:0,fontWeight:500,color:'#A0A0A4'}}> (fixed — forwarders quote against it)</span>}</label>
              {editing
                ? <div style={{fontFamily:'var(--mono)',fontSize:'13.5px',fontWeight:700,color:'#1A1A1C',padding:'9px 0'}}>{form.number}</div>
                : <input style={inputS} value={form.number} onChange={e=>f('number')(e.target.value)} />}
            </div>
            <div><label style={lblS}>Client *</label><select style={inputS} value={form.client} onChange={e=>f('client')(e.target.value)}><option value="">—</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row-2" style={{marginTop:'12px'}}>
            <div><label style={lblS}>Freight Forwarder</label><select style={inputS} value={form.forwarder} onChange={e=>f('forwarder')(e.target.value)}><option value="">—</option>{forwarders.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label style={lblS}>Cargo Ready Date</label><input type="date" style={inputS} value={form.ready} onChange={e=>f('ready')(e.target.value)} /></div>
          </div>
          <div className="form-row-3" style={{marginTop:'12px'}}>
            <div><label style={lblS}>Origin</label><input style={inputS} value={form.origin} onChange={e=>f('origin')(e.target.value)} placeholder="e.g. Ningbo, CN" /></div>
            <div><label style={lblS}>Destination</label><input style={inputS} value={form.destination} onChange={e=>f('destination')(e.target.value)} placeholder="e.g. Savannah, GA" /></div>
            <div><label style={lblS}>Incoterm</label><input style={inputS} value={form.incoterm} onChange={e=>f('incoterm')(e.target.value)} placeholder="FOB, DDP…" /></div>
          </div>
          <div style={{marginTop:'14px'}}>
            <label style={lblS}>Container to fill</label>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              {CONTAINER_TYPES.map(c=>{ const on=form.containerType===c.key; return (
                <button key={c.key} type="button" onClick={()=>{markDirty();f('containerType')(c.key);}} style={{flex:'1 1 120px',textAlign:'left',padding:'10px 13px',borderRadius:'10px',border:'1.5px solid '+(on?'#0071E3':'#E5E7EB'),background:on?'#EAF3FE':'#fff',cursor:'pointer',transition:'.12s'}}>
                  <div style={{fontSize:'13px',fontWeight:600,color:on?'#0071E3':'#1A1A1C'}}>{c.label}</div>
                  <div style={{fontSize:'11px',color:'#8A8A8E',marginTop:'2px'}}>{c.cbm} CBM usable</div>
                </button>
              ); })}
            </div>
          </div>

          {/* Line items */}
          <div style={{marginTop:'18px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px',gap:'8px',flexWrap:'wrap'}}>
              <span style={{fontSize:'12px',fontWeight:700,color:'#1A1A1C',textTransform:'uppercase',letterSpacing:'.05em'}}>Carton / CBM breakdown</span>
              <div style={{display:'flex',gap:'7px'}}>
                <button type="button" onClick={autoFillCartons} title={"Fill "+((CONTAINER_MAP[form.containerType]||CONTAINER_MAP['40HQ']).label)+" to capacity"} style={{background:'#EAF3FE',border:'1px solid #BFDBFE',borderRadius:'7px',padding:'4px 11px',fontSize:'12px',fontWeight:600,color:'#0071E3',cursor:'pointer'}}>⚡ Auto-fill container</button>
                <button type="button" onClick={addLine} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'7px',padding:'4px 10px',fontSize:'12px',fontWeight:500,color:'#4A4A4E',cursor:'pointer'}}>+ Add line</button>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 66px 66px 74px 66px 78px 24px',gap:'6px',marginBottom:'6px'}}>
              {['Description','Pcs/ctn','Cartons','CBM/ctn','Kg/ctn','Line CBM',''].map((h,i)=><div key={i} style={{fontSize:'9.5px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.04em',color:'#A0A0A4',textAlign:i>=1&&i<6?'right':'left'}}>{h}</div>)}
            </div>
            {lines.map((l,i)=>{
              const lineCbm = (Number(l.cartons)||0)*(Number(l.cbmPer)||0);
              const linePcs = (Number(l.cartons)||0)*(Number(l.upc)||0);
              return (
                <div key={i} style={{marginBottom:'6px'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 66px 66px 74px 66px 78px 24px',gap:'6px',alignItems:'center'}}>
                  <input style={{...inputS,padding:'8px 9px',fontSize:'12.5px'}} value={l.desc} onChange={setLine(i,'desc')} placeholder="Product / description" />
                  <input style={{...inputS,padding:'8px 9px',fontSize:'12.5px',textAlign:'right'}} value={l.upc} onChange={setLine(i,'upc')} placeholder="0" />
                  <input style={{...inputS,padding:'8px 9px',fontSize:'12.5px',textAlign:'right'}} value={l.cartons} onChange={setLine(i,'cartons')} placeholder="0" />
                  <input style={{...inputS,padding:'8px 9px',fontSize:'12.5px',textAlign:'right'}} value={l.cbmPer} onChange={setLine(i,'cbmPer')} placeholder="0.000" />
                  <input style={{...inputS,padding:'8px 9px',fontSize:'12.5px',textAlign:'right'}} value={l.weight} onChange={setLine(i,'weight')} placeholder="0" />
                  <div style={{fontSize:'12.5px',fontWeight:600,color:'#1A1A1C',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{lineCbm>0?lineCbm.toFixed(3):'—'}</div>
                  <button type="button" onClick={()=>rmLine(i)} style={{background:'none',border:'none',color:'#C0C0C4',cursor:'pointer',fontSize:'17px',lineHeight:1}}>×</button>
                </div>
                {linePcs>0 && <div style={{fontSize:'10.5px',color:'#8A8A8E',paddingLeft:'10px',marginTop:'3px'}}>= {fmtNum(linePcs)} pcs</div>}
                </div>
              );
            })}
          </div>

          {/* Container calc */}
          <div style={{marginTop:'18px',background:'#F7F7F9',borderRadius:'13px',padding:'16px 18px'}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'12px'}}>
              <div><div style={{fontSize:'10px',color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'5px'}}>Total pieces</div><div style={{fontSize:'20px',fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{fmtNum(calc.pieces)}</div></div>
              <div><div style={{fontSize:'10px',color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'5px'}}>Total cartons</div><div style={{fontSize:'20px',fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{fmtNum(calc.cartons)}</div></div>
              <div><div style={{fontSize:'10px',color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'5px'}}>Total CBM</div><div style={{fontSize:'20px',fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{calc.cbm.toFixed(2)}</div></div>
              <div><div style={{fontSize:'10px',color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'5px'}}>{(CONTAINER_MAP[form.containerType]||CONTAINER_MAP['40HQ']).label} needed</div><div style={{fontSize:'20px',fontWeight:700,color:'#0071E3',fontVariantNumeric:'tabular-nums'}}>{containers}</div></div>
              <div><div style={{fontSize:'10px',color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'5px'}}>Utilization</div><div style={{fontSize:'20px',fontWeight:700,color:utilization>92?'#D14343':'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{utilization.toFixed(0)}%</div></div>
            </div>
            {containers>0 && calc.pieces>0 && (
              <div style={{display:'flex',gap:'18px',flexWrap:'wrap',marginTop:'14px',paddingTop:'13px',borderTop:'1px solid #E6E6EA'}}>
                <div style={{fontSize:'12px',color:'#4A4A4E'}}><b style={{color:'#1A1A1C'}}>{fmtNum(Math.round(calc.pieces/containers))}</b> pcs per container</div>
                <div style={{fontSize:'12px',color:'#4A4A4E'}}><b style={{color:'#1A1A1C'}}>{fmtNum(Math.round(calc.cartons/containers))}</b> cartons per container</div>
                {lines.length===1 && Number(lines[0].upc)>0 && <div style={{fontSize:'12px',color:'#4A4A4E'}}><b style={{color:'#1A1A1C'}}>{fmtNum(Number(lines[0].upc))}</b> pcs per carton</div>}
              </div>
            )}
            <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'12px',lineHeight:1.5}}>Based on {capCbm} CBM usable per {(CONTAINER_MAP[form.containerType]||CONTAINER_MAP['40HQ']).label} container. {containers>0 && utilization<70 ? 'Low fill — consider a smaller container or LCL.' : containers>0 ? 'Good fill for FCL.' : 'Add cartons and CBM to calculate.'}</div>
          </div>

          <div style={{marginTop:'12px'}}><label style={lblS}>Notes for forwarder</label><textarea style={{...inputS,minHeight:'56px',resize:'vertical'}} value={form.notes} onChange={e=>f('notes')(e.target.value)} placeholder="Special handling, stackability, delivery requirements…" /></div>
          </>
          )}
        </div>
        <div className="modal-foot" style={{display:'flex',justifyContent:'space-between',gap:'10px'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {/* On edit there is one action: save the corrections. Generate & Send and
              Save draft belong to creation -- the card already carries RFQ for sending
              and Sheet for printing, and re-running either from here would restamp a
              quote that has already gone out to forwarders. */}
          {editing ? (
            <button className="btn btn-dark" onClick={()=>save()} disabled={saving}>{saving?'Saving…':'Save changes'}</button>
          ) : picked ? (
          <div style={{display:'flex',gap:'8px'}}>
            <button className="btn btn-ghost" onClick={()=>save('draft')} disabled={saving}>Save draft</button>
            <button className="btn btn-dark" onClick={generate} disabled={saving}>{saving?'Working…':'Generate & Send'}</button>
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
// Open a printable freight quote sheet in a new window
function openFreightSheet(q, clientName, forwarderName) {
  const win = window.open('', '_blank');
  if (win) win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating freight sheet…</body>');
  const html = buildFreightDoc(q, clientName, forwarderName);
  if (win) { win.document.open(); win.document.write(html); win.document.close(); setTimeout(()=>{ try{ win.focus(); win.print(); }catch(e){} }, 500); }
}

function buildFreightDoc(q, clientName, forwarderName) {
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fd = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
  const rows = (q.line_items||[]).map(l=>
    '<tr>'
    +'<td style="padding:9px 12px;border-bottom:1px solid #eef;">'+esc(l.desc)+'</td>'
    +'<td style="padding:9px 12px;border-bottom:1px solid #eef;text-align:right;">'+(l.upc?Number(l.upc).toLocaleString():'—')+'</td>'
    +'<td style="padding:9px 12px;border-bottom:1px solid #eef;text-align:right;">'+(l.cartons||0).toLocaleString()+'</td>'
    +'<td style="padding:9px 12px;border-bottom:1px solid #eef;text-align:right;">'+(l.pieces?Number(l.pieces).toLocaleString():'—')+'</td>'
    +'<td style="padding:9px 12px;border-bottom:1px solid #eef;text-align:right;">'+(l.cbm_per||0).toFixed(4)+'</td>'
    +'<td style="padding:9px 12px;border-bottom:1px solid #eef;text-align:right;">'+(l.weight||0)+'</td>'
    +'<td style="padding:9px 12px;border-bottom:1px solid #eef;text-align:right;font-weight:600;">'+(l.cbm_total||0).toFixed(3)+'</td>'
    +'</tr>'
  ).join('');
  const totalPieces = (q.line_items||[]).reduce((a,l)=>a+(Number(l.pieces)||0),0);
  const box = (label,val) => '<div style="flex:1;min-width:120px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:4px;">'+label+'</div><div style="font-size:15px;color:#0f172a;font-weight:600;">'+val+'</div></div>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>Freight Quote '+esc(q.quote_number)+'</title></head>'
    +'<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#0f172a;background:#fff;">'
    +'<div style="max-width:820px;margin:0 auto;padding:44px 48px;">'
    // header
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:20px;margin-bottom:8px;">'
      +'<div><div style="font-size:24px;font-weight:800;letter-spacing:-.02em;">KING UNIVERSAL INC.</div><div style="font-size:12px;color:#64748b;margin-top:3px;">Freight Quote Request</div></div>'
      +'<div style="text-align:right;"><div style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;">'+esc(q.quote_number)+'</div><div style="font-size:12px;color:#64748b;margin-top:3px;">'+fd(new Date().toISOString())+'</div></div>'
    +'</div>'
    // parties
    +'<div style="display:flex;gap:40px;margin:24px 0 20px;">'
      +'<div style="flex:1;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:5px;">Shipper / Client</div><div style="font-size:14px;font-weight:600;">'+esc(clientName||'—')+'</div></div>'
      +'<div style="flex:1;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:5px;">Freight Forwarder</div><div style="font-size:14px;font-weight:600;">'+esc(forwarderName||'—')+'</div></div>'
    +'</div>'
    // route boxes
    +'<div style="display:flex;gap:20px;background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:24px;flex-wrap:wrap;">'
      +box('Origin', esc(q.origin||'—'))
      +box('Destination', esc(q.destination||'—'))
      +box('Incoterm', esc(q.incoterm||'—'))
      +box('Cargo Ready', fd(q.ready_date))
    +'</div>'
    // line items
    +'<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">'
      +'<thead><tr style="background:#0f172a;color:#fff;">'
        +'<th style="padding:10px 12px;text-align:left;font-weight:600;">Description</th>'
        +'<th style="padding:10px 12px;text-align:right;font-weight:600;">Pcs/Ctn</th>'
        +'<th style="padding:10px 12px;text-align:right;font-weight:600;">Cartons</th>'
        +'<th style="padding:10px 12px;text-align:right;font-weight:600;">Pieces</th>'
        +'<th style="padding:10px 12px;text-align:right;font-weight:600;">CBM/ctn</th>'
        +'<th style="padding:10px 12px;text-align:right;font-weight:600;">Kg/ctn</th>'
        +'<th style="padding:10px 12px;text-align:right;font-weight:600;">Total CBM</th>'
      +'</tr></thead><tbody>'+rows+'</tbody></table>'
    // totals + container recommendation
    +'<div style="display:flex;gap:20px;margin-top:24px;flex-wrap:wrap;">'
      +'<div style="flex:2;min-width:260px;background:#f8fafc;border-radius:12px;padding:18px 20px;">'
        +(totalPieces>0?'<div style="display:flex;justify-content:space-between;margin-bottom:10px;"><span style="color:#64748b;font-size:13px;">Total pieces</span><span style="font-weight:700;font-size:14px;">'+totalPieces.toLocaleString()+'</span></div>':'')
        +'<div style="display:flex;justify-content:space-between;margin-bottom:10px;"><span style="color:#64748b;font-size:13px;">Total cartons</span><span style="font-weight:700;font-size:14px;">'+(q.total_cartons||0).toLocaleString()+'</span></div>'
        +'<div style="display:flex;justify-content:space-between;margin-bottom:10px;"><span style="color:#64748b;font-size:13px;">Total volume</span><span style="font-weight:700;font-size:14px;">'+(q.total_cbm||0).toFixed(2)+' CBM</span></div>'
        +'<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;font-size:13px;">Total weight</span><span style="font-weight:700;font-size:14px;">'+(q.total_weight_kg||0).toLocaleString()+' kg</span></div>'
      +'</div>'
      +'<div style="flex:1;min-width:200px;background:#0f172a;color:#fff;border-radius:12px;padding:18px 20px;">'
        +'<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.6);margin-bottom:8px;">Container recommendation</div>'
        +'<div style="font-size:32px;font-weight:800;letter-spacing:-.02em;">'+(q.containers_needed||0)+' × '+esc(q.container_type||"40'HQ")+'</div>'
        +'<div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:6px;">'+(q.utilization_pct||0)+'% utilization · '+(q.cbm_max||68)+' CBM max/container</div>'
        +((totalPieces>0&&q.containers_needed>0)?'<div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.15);">'+Math.round(totalPieces/q.containers_needed).toLocaleString()+' pcs · '+Math.round((q.total_cartons||0)/q.containers_needed).toLocaleString()+' cartons per container</div>':'')
      +'</div>'
    +'</div>'
    +(q.notes?'<div style="margin-top:24px;padding:16px 18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;color:#78350f;"><b>Notes:</b> '+esc(q.notes)+'</div>':'')
    +'<div style="margin-top:36px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">Please quote FCL and, where relevant, LCL rates for the above. King Universal Inc. · Raleigh, NC</div>'
    +'</div></body></html>';
}

// ── Sales Order / Order Confirmation document (client-facing — CLIENT PRICES ONLY) ──
function buildSODoc(d) {
  const cur = d.currency || 'USD';
  const m = (n) => n==null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:cur,minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const fd = s => { if(!s) return '—'; const dt=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(dt)?'—':dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
  const fn = n => n==null ? '—' : new Intl.NumberFormat('en-US').format(n);
  const subtotal = (d.lines||[]).reduce((a,l)=>a+(Number(l.line_amount)||0),0);

  const lines = (d.lines||[]).map((l,i) => {
    const size = l.size || '';
    const bg = i % 2 === 0 ? '#fff' : '#f9fafb';
    return '<tr style="background:'+bg+'">'
      +'<td style="padding:15px 18px;vertical-align:top;border-bottom:1px solid #e5e7eb;">'
        +'<div style="font-size:15px;font-weight:600;color:#0f172a;">'+(l.description||'—')+'</div>'
        +(size?'<div style="margin-top:6px;"><span style="display:inline-block;background:#eef1f6;border:1px solid #e5e7eb;border-radius:5px;padding:3px 9px;font-size:13px;font-weight:700;color:#0c1322;letter-spacing:.04em;">Size '+size+'</span></div>':'')
        +(l.sku?'<div style="font-size:11.5px;color:#6b7280;font-family:monospace;margin-top:4px;"><span style="color:#9ca3af;">SKU</span> '+l.sku+'</div>':'')
      +'</td>'
      +'<td style="padding:15px 14px;text-align:center;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:700;color:#0f172a;font-family:monospace;">'+fn(l.quantity)+'</td>'
      // THE UNIT PRICE CELL ON A DOCUMENT THE CLIENT RECEIVES. unitPrice, not
      // the local m(): m() is fixed at 2dp and would print $0.18 for a bag that
      // costs $0.1778, understating the price on the customer's own order
      // confirmation. The line-amount cell below keeps m() -- that is money owed.
      +'<td style="padding:15px 14px;text-align:right;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;font-family:monospace;">'+unitPrice(l.client_price,cur)+'</td>'
      +'<td style="padding:15px 18px;text-align:right;vertical-align:top;border-bottom:1px solid #e5e7eb;font-size:15px;font-weight:700;color:#0f172a;font-family:monospace;">'+m(l.line_amount)+'</td>'
      +'</tr>';
  }).join('');

  const termBoxes = [
    ['Order Date', fd(d.order_date)],
    d.cargo_ready_date ? ['Cargo Ready Date', fd(d.cargo_ready_date)] : null,
    d.indc_date ? ['In-DC Date', fd(d.indc_date)] : null,
    d.cancel_date ? ['Cancel Date', fd(d.cancel_date)] : null,
    ['Payment Terms', d.payment_terms||'—'],
    d.shipping_method ? ['Shipping Method', d.shipping_method] : null,
  ].filter(Boolean).map(([l,v]) =>
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;">'
    +'<div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">'+l+'</div>'
    +'<div style="font-size:15px;font-weight:600;color:#0f172a;">'+v+'</div>'
    +'</div>'
  ).join('');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
+'<title>Order Confirmation — '+(d.client_po||d.so_ref||'')+'</title>'
+'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">'
+'<style>*{box-sizing:border-box;margin:0;padding:0;}html,body{font-family:\'Inter\',system-ui,sans-serif;font-size:14px;color:#0f172a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.page{max-width:820px;margin:0 auto;padding:48px;}@media print{@page{size:A4;margin:20mm;}.page{padding:0;max-width:none;}}</style>'
+'</head><body><div class="page">'

// Header
+'<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:28px;border-bottom:3px solid #0c1322;margin-bottom:32px;">'
  +'<div>'
    +'<div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">King Universal Inc.</div>'
    +'<div style="font-size:34px;font-weight:800;color:#0c1322;letter-spacing:-.02em;line-height:1;">Order Confirmation</div>'
  +'</div>'
  +'<div style="text-align:right;">'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">PO Reference</div>'
    +'<div style="font-size:24px;font-weight:700;color:#0c1322;font-family:\'JetBrains Mono\',monospace;">'+(d.client_po||d.so_ref||'—')+'</div>'
    +'<div style="font-size:12px;color:#94a3b8;margin-top:4px;">Confirmed '+fd(d.order_date)+'</div>'
  +'</div>'
+'</div>'

// Client banner
+(d.client_name?'<div style="background:linear-gradient(135deg,#0c1322 0%,#1e3a5f 100%);border-radius:12px;padding:18px 24px;margin-bottom:28px;">'
  +'<div style="font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:4px;">Prepared For</div>'
  +'<div style="font-size:20px;font-weight:700;color:#fff;">'+d.client_name+'</div>'
+'</div>':'')

// Ship-to address
+(d.ship_to?'<div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-bottom:28px;">'
  +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Ship To</div>'
  +'<div style="font-size:14px;color:#0f172a;line-height:1.7;">'+d.ship_to.replace(/\n/g,'<br>')+'</div>'
+'</div>':'')

// Terms
+'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:32px;">'+termBoxes+'</div>'

// Line items
+'<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:28px;">'
  +'<div style="background:#0c1322;padding:14px 18px;display:grid;grid-template-columns:1fr 80px 120px 130px;gap:8px;">'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);">Description</div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);text-align:center;">Qty</div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);text-align:right;">Unit Price</div>'
    +'<div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);text-align:right;">Amount</div>'
  +'</div>'
  +'<table style="width:100%;border-collapse:collapse;"><tbody>'+lines+'</tbody></table>'
+'</div>'

// Total
+'<div style="display:flex;justify-content:flex-end;margin-bottom:40px;">'
  +'<div style="width:300px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 22px;">'
    +'<div style="display:flex;justify-content:space-between;padding:14px 0 0;"><span style="font-size:17px;font-weight:700;color:#0f172a;">Order Total '+cur+'</span><span style="font-size:20px;font-weight:800;color:#0c1322;font-family:\'JetBrains Mono\',monospace;">'+m(subtotal)+'</span></div>'
  +'</div>'
+'</div>'

// Notes
+(d.notes?'<div style="margin-bottom:32px;"><div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Notes</div><div style="font-size:13.5px;color:#374151;line-height:1.6;">'+d.notes+'</div></div>':'')

// Footer
+'<div style="padding-top:24px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#94a3b8;">Thank you for your business · King Universal Inc.</div>'

+'</div></body></html>';
}
function ConfirmModal({ title, message, confirmLabel='Delete', danger=true, onConfirm, onCancel }) {
  // Verified: zero controls, so both snapshots are "0", they compare equal, and
  // clicking outside cancels silently -- which is what it already did.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onCancel);
  return (
    <div className="modal-overlay" onClick={guardedClose} style={{zIndex:10000}}>
      <div ref={cardRef} className="modal-box" style={{maxWidth:'380px',padding:'32px 28px',textAlign:'center'}} onClick={e=>e.stopPropagation()}>
        <div style={{width:'52px',height:'52px',borderRadius:'50%',background:danger?'#fef2f2':'#f0f9ff',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 18px'}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={danger?'#e53935':'#3461e0'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {danger
              ? <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></>
              : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>}
          </svg>
        </div>
        <h3 style={{fontFamily:'var(--sans)',fontSize:'16px',fontWeight:600,color:'var(--ink)',marginBottom:'8px'}}>{title}</h3>
        {message && <p style={{fontSize:'13.5px',color:'var(--muted)',lineHeight:1.55,marginBottom:'28px'}}>{message}</p>}
        <div style={{display:'flex',gap:'10px',justifyContent:'center'}}>
          <button className="btn btn-ghost" style={{minWidth:'90px'}} onClick={onCancel}>Cancel</button>
          <button className="btn" style={{minWidth:'90px',background:danger?'#e53935':'var(--accent)',color:'#fff',fontWeight:600}} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── App Root ──────────────────────────────────────────────────────────────────
// ── New conversation ─────────────────────────────────────────────────────────
// Nothing in this app could create a thread until now. RLS was never the
// obstacle -- threads_rw already grants portal.is_kui_staff() ALL -- it was
// simply a missing screen, so a conversation could only ever begin with the
// client writing first.
//
// ONLY COMPANIES WITH AN APPROVED PORTAL USER. A thread with a company that has
// no login is a message nobody can ever read: it renders perfectly in here and
// reaches no one. The list is short on purpose and grows as users are approved.
function NewThreadModal({ options, initialCompanyId, onClose, onCreated }) {
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  const [companyId, setCompanyId] = useState(initialCompanyId || '');
  const [name, setName]           = useState('');
  const [busy, setBusy]           = useState(false);
  const [err,  setErr]            = useState('');

  const create = async () => {
    if (!companyId || busy) return;
    setErr(''); setBusy(true);
    try {
      // company_id is the only column without a default. name falls back to the
      // column's own 'New Conversation' rather than being sent empty, so the
      // default is expressed in one place -- the schema -- not two.
      const { data, error } = await SB.schema('portal').from('threads')
        .insert({ company_id: companyId, name: name.trim() || 'New Conversation' })
        .select().single();
      if (error) throw new Error(error.message);
      onCreated(data);
    } catch (e) {
      setErr('Could not create the conversation: ' + (e.message || 'unknown error'));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box" style={{maxWidth:'440px'}}>
        <div className="modal-head"><h3>New Conversation</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row">
            <label>Client *</label>
            <select className="form-select" value={companyId} onChange={e=>setCompanyId(e.target.value)}>
              <option value="">Select a client…</option>
              {options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Subject <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(optional)</span></label>
            <input className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="New Conversation" />
          </div>
          {/* Says plainly that creating is not telling. No trigger fires on a
              thread insert -- all five portal triggers are on messages,
              order_notes and delivery_requests -- so the client learns of this
              only when the first message is sent, which is what lands them an
              email. */}
          <div style={{fontSize:'12px',color:'var(--muted)',lineHeight:1.5,marginTop:'2px'}}>
            Only clients with an approved portal login are listed. Creating a conversation does not notify them — your first message does.
          </div>
          {err && <div style={{fontSize:'12.5px',color:'var(--hot)',marginTop:'10px'}}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={create} disabled={!companyId||busy}>{busy?'Creating…':'Create'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Client Relations ──────────────────────────────────────────────────────────
// `user` is a prop, not a fetch. The signed-in user is already loaded at the
// render site; re-reading the session here would be a second source of truth for
// something the shell already knows.
function ClientRelations({ user }) {
  const SP = t => SB.schema('portal').from(t);
  const toast = useToast();

  const [allThreads, setAllThreads] = useState([]);
  const [companies,  setCompanies]  = useState({});        // id → name
  const [unreadMap,  setUnreadMap]  = useState({});        // companyId → count
  const [loading,    setLoading]    = useState(true);

  const [selCoId,     setSelCoId]     = useState(null);
  const [selThreadId, setSelThreadId] = useState(null);
  const [msgs,        setMsgs]        = useState([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [draft,       setDraft]       = useState('');
  const [sending,     setSending]     = useState(false);
  const [sendErr,     setSendErr]     = useState('');
  const [clientSearch, setClientSearch] = useState('');
  // Archived threads are hidden from Panel 2 by default and revealed by this.
  // Staff RLS still returns them -- threads_rw's archived filter applies to the
  // CLIENT branch only -- so this is presentation, and nothing here can make an
  // archived conversation unreachable.
  const [showArchived, setShowArchived] = useState(false);
  // Companies with at least one APPROVED portal user -- "clients you can talk
  // to". Panel 1 is seeded from this rather than derived purely from threads, so
  // a client who has never written still appears and can be started with.
  const [portalCos, setPortalCos] = useState([]);   // [{id,name}]
  // null = closed. Otherwise { companyId } -- '' for the global entry point,
  // a real id when opened from a company's own panel.
  const [newThread, setNewThread] = useState(null);
  const endRef = useRef(null);
  const draftRef = useRef(null);

  // ── load everything ────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const [{ data: threads }, { data: cos }, { data: unread }, { data: approved }] = await Promise.all([
      SP('threads').select('*').order('last_message_at', { ascending: false }),
      SB.from('companies').select('id,name').order('name'),
      SP('messages').select('thread_id,company_id').eq('author_type', 'client').eq('read_by_kui', false),
      // Membership, not a join: PostgREST cannot join portal.users to
      // vessl.companies across schemas, and the company names are already being
      // fetched above. Distinct company_ids of approved users is the whole test.
      SP('users').select('company_id').eq('status', 'approved'),
    ]);
    const coMap = {};
    (cos||[]).forEach(c => { coMap[c.id] = c.name; });
    // ┌─────────────────────────────────────────────────────────────────────────┐
    // │ UNREAD EXCLUDES ARCHIVED THREADS.                                       │
    // │                                                                         │
    // │ The unread query cannot express this itself -- it selects from          │
    // │ portal.messages, and PostgREST will not join to portal.threads -- so the │
    // │ filter happens here, against the thread rows this same load just         │
    // │ fetched. An archived conversation that keeps badging is a dot nobody can │
    // │ clear without un-archiving first.                                        │
    // │                                                                         │
    // │ A message with a NULL thread_id is NOT in an archived thread and still   │
    // │ counts: Set.has(null) is false, which is the behaviour we want rather    │
    // │ than an accident of it.                                                  │
    // └─────────────────────────────────────────────────────────────────────────┘
    const archivedIds = new Set((threads||[]).filter(t => t.archived_at).map(t => t.id));
    const uMap = {};
    (unread||[]).forEach(m => {
      if (archivedIds.has(m.thread_id)) return;
      uMap[m.company_id] = (uMap[m.company_id]||0) + 1;
    });
    // Deduplicated: a company with two approved users must not appear twice.
    // Sorted by name so the picker and Panel 1 agree on order.
    const pIds = [...new Set((approved||[]).map(u => u.company_id).filter(Boolean))];
    setPortalCos(pIds.map(id => ({ id, name: coMap[id] || 'Unknown' }))
                     .sort((a,b) => a.name.localeCompare(b.name)));
    setAllThreads(threads||[]);
    setCompanies(coMap);
    setUnreadMap(uMap);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── load messages for a thread ─────────────────────────────────────────────
  // Declared ABOVE the realtime effect, not below it. The effect lists this in
  // its dependency array, and a dep array is evaluated during render -- so with
  // the old ordering that reference sat in the temporal dead zone of a `const`
  // declared further down, which is a ReferenceError, not a warning.
  const loadMsgs = useCallback(async (threadId, markRead=true) => {
    if (!threadId) return;
    setMsgsLoading(true);
    const { data, error } = await SP('messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true });
    if (error) { toast('Error loading messages', 'err'); }
    setMsgs(data||[]);
    setMsgsLoading(false);
    if (markRead) {
      // ┌─────────────────────────────────────────────────────────────────────┐
      // │ THE UPDATE REPORTS WHAT IT ACTUALLY CLEARED.                        │
      // │                                                                     │
      // │ `.eq('read_by_kui', false)` narrows the write to rows that were     │
      // │ genuinely unread, and `.select('id')` returns them -- so the count   │
      // │ below is what this call changed, not an estimate. Re-opening a       │
      // │ thread now writes nothing and decrements nothing, where before it    │
      // │ rewrote every client message in the thread every time.              │
      // └─────────────────────────────────────────────────────────────────────┘
      const { data: cleared } = await SP('messages')
        .update({ read_by_kui: true })
        .eq('thread_id', threadId).eq('author_type', 'client').eq('read_by_kui', false)
        .select('id');
      const n = (cleared||[]).length;
      if (n > 0) {
        const thread = allThreads.find(t => t.id === threadId);
        // SUBTRACT THIS THREAD'S SHARE, do not clear the company. unreadMap is
        // keyed by company, and the old code deleted the whole key -- so a
        // client with two unread threads dropped to zero the moment either one
        // was opened, and only the next loadAll() put the other one back.
        if (thread) setUnreadMap(prev => {
          const left = (prev[thread.company_id]||0) - n;
          const next = { ...prev };
          if (left > 0) next[thread.company_id] = left; else delete next[thread.company_id];
          return next;
        });
      }
    }
  }, [allThreads]);

  // real-time: any new portal message → refresh thread list + live conversation
  useEffect(() => {
    let ch;
    try {
      ch = SB.channel('cr-rt')
        .on('postgres_changes', { event:'INSERT', schema:'portal', table:'messages' }, payload => {
          loadAll();
          if (payload.new?.thread_id === selThreadId) {
            // MARK IT READ. This passed `false`, so a message arriving while its
            // thread was already open rendered but stayed unread forever -- the
            // badge kept counting it until you navigated away and came back,
            // which is the one moment you have most certainly seen it.
            //
            // Gated on visibility: a background tab is not somebody reading. A
            // message landing in a thread left open on another desktop should
            // still be waiting when they come back to it.
            const looking = typeof document === 'undefined' || document.visibilityState === 'visible';
            loadMsgs(selThreadId, looking);
          }
        }).subscribe();
    } catch(e){}
    return () => { if(ch) SB.removeChannel(ch); };
  }, [selThreadId, loadAll, loadMsgs]);

  // ── coming back to the tab counts as reading ───────────────────────────────
  // The realtime handler above deliberately does NOT mark read while the tab is
  // hidden, which is right at the time -- but it leaves a badge that is stale
  // the instant the user looks at the thread again. Without this, the only way
  // to clear it is to re-click a thread that is already open, which reads as the
  // badge being stuck rather than as a rule about visibility.
  //
  // Re-runs loadMsgs rather than just the update, so anything that arrived while
  // the tab was backgrounded is fetched too -- a dropped realtime event heals
  // here instead of leaving the pane silently behind the database.
  //
  // Cheap to fire on every focus: the update is narrowed to rows that are
  // actually unread, so returning to a thread with nothing new writes nothing.
  useEffect(() => {
    if (!selThreadId) return;
    const onVis = () => { if (document.visibilityState === 'visible') loadMsgs(selThreadId, true); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [selThreadId, loadMsgs]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // ── select thread ──────────────────────────────────────────────────────────
  const selectThread = t => {
    setSelThreadId(t.id);
    setSelCoId(t.company_id);
    setSendErr('');
    setDraft('');
    loadMsgs(t.id, true);
  };

  // ── created a thread ───────────────────────────────────────────────────────
  // Lands in the compose box rather than back on the list. A thread with no
  // messages notifies nobody -- no trigger fires on a thread insert -- so
  // creating one and walking away achieves nothing at all. Selecting it puts the
  // cursor where the useful next action is; the focus effect keyed on
  // selThreadId does the rest.
  //
  // loadAll() first and awaited: selectThread's own path reads allThreads, and
  // the new row has to be in state before anything looks for it.
  const onThreadCreated = useCallback(async (t) => {
    setNewThread(null);
    if (!t) return;
    await loadAll();
    setSelCoId(t.company_id);
    setSelThreadId(t.id);
    setMsgs([]);          // known empty; skip the round trip
    setDraft('');
    setSendErr('');
    toast('Conversation created', 'ok');
  }, [loadAll, toast]);

  // ── archive / unarchive ────────────────────────────────────────────────────
  // A timestamp, not a flag: NULL is active, a value is both "archived" and
  // "when". Toggling reads the CURRENT row rather than a local guess, so two
  // people archiving at once converge instead of fighting.
  //
  // Deliberately not confirmed. Delete asks because it destroys; archiving is
  // reversible from the same button, and a confirm on a reversible action just
  // trains people to click through confirms.
  const [archBusy, setArchBusy] = useState(false);
  const toggleArchive = async (t) => {
    if (!t || archBusy) return;
    setArchBusy(true);
    const next = t.archived_at ? null : new Date().toISOString();
    const { error } = await SP('threads').update({ archived_at: next }).eq('id', t.id);
    if (error) { toast('Could not '+(next?'archive':'restore')+': '+error.message, 'err'); setArchBusy(false); return; }
    await loadAll();
    // Archiving the open thread closes it: it has just left the default list, so
    // leaving it selected would show a conversation the panel beside it no longer
    // offers. Restoring keeps it open, because it is back where it belongs.
    if (next) { setSelThreadId(null); setMsgs([]); }
    toast(next ? 'Conversation archived' : 'Conversation restored', 'ok');
    setArchBusy(false);
  };

  // ── delete thread ──────────────────────────────────────────────────────────
  const [confirmDelId, setConfirmDelId] = useState(null);
  const deleteThread = async (threadId) => {
    try {
      // remove messages first (in case no cascade), then the thread
      await SP('messages').delete().eq('thread_id', threadId);
      const { error } = await SP('threads').delete().eq('id', threadId);
      if (error) { toast('Could not delete: ' + error.message, 'err'); return; }
      setAllThreads(prev => prev.filter(t => t.id !== threadId));
      if (selThreadId === threadId) { setSelThreadId(null); setMsgs([]); }
      setConfirmDelId(null);
      toast('Conversation deleted', 'ok');
    } catch (e) {
      toast('Could not delete conversation', 'err');
    }
  };

  // ── send message ───────────────────────────────────────────────────────────
  const send = async () => {
    const body = draft.trim();
    if (!body || !selThreadId || sending) return;
    setSendErr(''); setSending(true);
    const selThread = allThreads.find(t => t.id === selThreadId);
    try {
      const { error } = await SP('messages').insert({
        company_id:   selThread?.company_id,
        thread_id:    selThreadId,
        author_type:  'kui_staff',
        author_name:  'KUI Team',
        // ┌─────────────────────────────────────────────────────────────────────┐
        // │ WRITTEN, BUT NOT DISPLAYED ANYWHERE. ON PURPOSE.                    │
        // │                                                                     │
        // │ Riley's call is one shared team voice: Client Relations shows        │
        // │ 'KUI Team' for every staff message, and nothing renders this column. │
        // │                                                                     │
        // │ It keeps being written because the alternative is a permanent gap.   │
        // │ Authorship cannot be reconstructed later -- nothing else records who │
        // │ typed a reply -- so switching the display back on a year from now    │
        // │ would show real names on new messages and 'KUI Team' on every        │
        // │ message sent in between. Recording it costs one column that no       │
        // │ client and no screen ever sees.                                      │
        // │                                                                     │
        // │ Do not "clean this up" as an unused write. See PORTAL.md.            │
        // └─────────────────────────────────────────────────────────────────────┘
        author_email: user?.email || null,
        body,
        read_by_client: false,
      });
      if (error) throw new Error(error.message);
      // ┌─────────────────────────────────────────────────────────────────────┐
      // │ THE THREAD PREVIEW IS THE TRIGGER'S JOB NOW.                        │
      // │                                                                     │
      // │ portal.trg_touch_thread_on_message updates last_message_body and    │
      // │ last_message_at inside the inserting transaction. Writing them again │
      // │ from here would be worse than redundant: this line used a browser    │
      // │ clock (new Date()) where the trigger uses the row's own server-side  │
      // │ created_at, so it reintroduced exactly the skew the trigger removes. │
      // │                                                                     │
      // │ It also closed a real gap. The portal did the same insert-then-      │
      // │ update as two statements, and realtime announces the INSERT the      │
      // │ moment it commits -- so every reader that arrived in between saw the │
      // │ PREVIOUS message in the list panes while the conversation pane, which│
      // │ reads messages directly, already showed the new one. Measured at 1.7 │
      // │ seconds on a live client send.                                       │
      // └─────────────────────────────────────────────────────────────────────┘
      setDraft('');
      await Promise.all([ loadMsgs(selThreadId, false), loadAll() ]);
      toast('Sent', 'ok');
    } catch(e) {
      const msg = 'Message failed: '+(e.message||'Unknown error. Check connection.');
      setSendErr(msg);
      toast(msg, 'err');
    }
    setSending(false);
  };

  // ── derived data ───────────────────────────────────────────────────────────
  // ┌───────────────────────────────────────────────────────────────────────────┐
  // │ THE UNION, NOT JUST THE APPROVED LIST.                                    │
  // │                                                                           │
  // │ Panel 1 is "clients you can talk to", seeded from the approved-portal      │
  // │ companies -- that is what lets a client who has never written appear at    │
  // │ all, which is the whole point of being able to start a thread.             │
  // │                                                                           │
  // │ But companies with EXISTING THREADS are unioned in rather than replaced.   │
  // │ If an account is ever un-approved, seeding from the approved list alone    │
  // │ would make their conversation history vanish from this screen -- hiding    │
  // │ data as a side effect of an access change, with nothing on screen saying   │
  // │ so. Threads outlive logins.                                                │
  // └───────────────────────────────────────────────────────────────────────────┘
  const clientIds = [...new Set([
    ...portalCos.map(c => c.id),
    ...allThreads.map(t => t.company_id).filter(Boolean),
  ])];
  // sort clients: most recent message first, unread bump to top
  const sortedClientIds = [...clientIds].sort((a,b) => {
    if (unreadMap[b] && !unreadMap[a]) return 1;
    if (unreadMap[a] && !unreadMap[b]) return -1;
    const aLast = allThreads.find(t=>t.company_id===a)?.last_message_at||'';
    const bLast = allThreads.find(t=>t.company_id===b)?.last_message_at||'';
    return bLast.localeCompare(aLast);
  });
  const threadsByCompany = {};
  allThreads.forEach(t => { if (!threadsByCompany[t.company_id]) threadsByCompany[t.company_id] = []; threadsByCompany[t.company_id].push(t); });
  const selThread = allThreads.find(t=>t.id===selThreadId);
  // focus compose when thread selected
  useEffect(() => { if (selThreadId && draftRef.current) draftRef.current.focus(); }, [selThreadId]);

  const allCompanyThreads = selCoId ? (threadsByCompany[selCoId]||[]) : [];
  const archivedCount = allCompanyThreads.filter(t => t.archived_at).length;
  // Membership on a positive condition, not an exclusion: show everything when
  // the toggle is on, otherwise only the active ones.
  const companyThreads = showArchived ? allCompanyThreads : allCompanyThreads.filter(t => !t.archived_at);
  const totalUnread = Object.values(unreadMap).reduce((a,b)=>a+b,0);
  const filteredClients = clientSearch.trim()
    ? sortedClientIds.filter(id => (companies[id]||'').toLowerCase().includes(clientSearch.toLowerCase()))
    : sortedClientIds;

  if (loading) return <div className="loading">Loading client messages…</div>;

  return (
    <div className="cr-shell">

      {newThread && (
        <NewThreadModal
          options={portalCos}
          initialCompanyId={newThread.companyId}
          onClose={()=>setNewThread(null)}
          onCreated={onThreadCreated}
        />
      )}

      {/* ── Panel 1: Clients ───────────────────────────────────────────────── */}
      <div className="cr-panel cr-clients">
        <div className="cr-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="cr-search" placeholder="Search clients…" value={clientSearch} onChange={e=>setClientSearch(e.target.value)} />
          {totalUnread>0 && <span className="cr-panel-badge">{totalUnread}</span>}
          {/* The GLOBAL entry point. Lives here rather than in the page header
              because the modal's state belongs to this component -- putting the
              button in pageActions would mean lifting it into the shell so the
              shell could open a dialog it knows nothing about. */}
          <button onClick={()=>setNewThread({ companyId:'' })} title="New conversation"
            style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',display:'flex',alignItems:'center',padding:'5px',borderRadius:'7px',marginLeft:'4px'}}
            onMouseEnter={e=>{e.currentTarget.style.background='var(--line-2)';e.currentTarget.style.color='var(--ink)';}}
            onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='var(--muted)';}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <div className="cr-panel-body">
          {filteredClients.length===0 && <div className="cr-empty" style={{paddingTop:40}}><p>{clientSearch?'No clients match':'No clients with portal access yet'}</p></div>}
          {filteredClients.map(cid => {
            const name = companies[cid]||'Unknown';
            const threads = threadsByCompany[cid]||[];
            const last = threads[0];
            const count = unreadMap[cid]||0;
            const active = selCoId===cid;
            return (
              <div key={cid} className={'cr-client-row'+(active?' active':'')} onClick={()=>{ setSelCoId(cid); if(!active){setSelThreadId(null);setMsgs([]);} }}>
                <div className="cr-client-av" style={{background:companyColor(name),color:'#0b1120'}}>{initials(name)}</div>
                <div className="cr-client-meta">
                  <div className="cr-client-name">{name}</div>
                  {/* The bare thread count used to be the fallback here, which
                      reads like lost data the moment a thread exists with no
                      messages yet: a client whose row said "Sounds good, thanks"
                      would suddenly say "2 threads". Falls through the newest
                      thread's body, then its NAME -- which is what actually
                      distinguishes a new conversation -- then a plain statement
                      of the empty case. Only a company with no threads at all
                      reaches the last one. */}
                  <div className="cr-client-sub">{count>0 ? <b style={{color:'var(--ink)'}}>{last?.last_message_body?.slice(0,36)||'New message'}</b> : (last?.last_message_body?.slice(0,36)||last?.name||'No conversations yet')}</div>
                </div>
                {count>0 && <span className="cr-badge">{count>99?'99+':count}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Panel 2: Threads ───────────────────────────────────────────────── */}
      <div className="cr-panel cr-threads">
        {!selCoId ? (
          <div className="cr-empty" style={{paddingTop:80}}>
            <div style={{fontSize:32,marginBottom:12,opacity:.2}}>←</div>
            <p style={{fontSize:13}}>Select a client</p>
          </div>
        ) : (
          <>
            <div className="cr-panel-head" style={{background:companyColor(companies[selCoId]||'')+'22',borderBottom:'1px solid var(--line-2)'}}>
              <div style={{display:'flex',alignItems:'center',gap:9}}>
                <div style={{width:22,height:22,borderRadius:6,background:companyColor(companies[selCoId]||''),display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'#0b1120'}}>{initials(companies[selCoId]||'')}</div>
                <span style={{fontWeight:700,color:'var(--ink)',textTransform:'none',fontSize:13}}>{companies[selCoId]||'Client'}</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{fontSize:11,color:'var(--muted)',fontWeight:500,letterSpacing:0}}>{companyThreads.length} thread{companyThreads.length!==1?'s':''}</span>
                {/* Only offered when there is something to reveal, so the control
                    never implies an archive that does not exist. Names the count
                    because "Show archived" alone gives no reason to press it. */}
                {archivedCount>0 && (
                  <button onClick={()=>setShowArchived(v=>!v)}
                    title={showArchived?'Hide archived conversations':'Show archived conversations'}
                    style={{background:showArchived?'var(--line-2)':'none',border:'1px solid var(--line)',cursor:'pointer',color:'var(--ink-2)',borderRadius:'7px',padding:'3px 9px',fontSize:'11.5px',fontWeight:600,letterSpacing:0}}>
                    {showArchived?'Hide archived':'Archived ('+archivedCount+')'}
                  </button>
                )}
                {/* Contextual entry point: the company is already selected, so it
                    arrives pre-picked and the modal is one field shorter. */}
                <button onClick={()=>setNewThread({ companyId:selCoId })} title={'New conversation with '+(companies[selCoId]||'this client')}
                  style={{background:'none',border:'1px solid var(--line)',cursor:'pointer',color:'var(--ink-2)',borderRadius:'7px',padding:'3px 9px',fontSize:'11.5px',fontWeight:600,letterSpacing:0}}>
                  + New
                </button>
              </div>
            </div>
            <div className="cr-panel-body">
              {companyThreads.length===0 && <div className="cr-empty" style={{paddingTop:40}}><p style={{fontSize:13}}>No conversations yet — start one with + New</p></div>}
              {companyThreads.map(t => {
                const active = selThreadId===t.id;
                return (
                  <div key={t.id} className={'cr-thread-row'+(active?' active':'')} onClick={()=>selectThread(t)}>
                    <div className={'cr-thread-icon'+(t.sales_order_id?' order':' general')}>
                      {t.sales_order_id
                        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
                    </div>
                    <div className="cr-thread-meta">
                      <div className="cr-thread-name">{t.name}</div>
                      <div className="cr-thread-preview">{t.last_message_body||'No messages yet'}</div>
                    </div>
                    <div className="cr-thread-time">{timeAgo(t.last_message_at)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Panel 3: Conversation ──────────────────────────────────────────── */}
      <div className="cr-panel cr-convo">
        {!selThreadId ? (
          <div className="cr-empty" style={{paddingTop:100}}>
            <div style={{fontSize:40,marginBottom:16,opacity:.15}}>💬</div>
            <div style={{fontWeight:600,color:'var(--ink-2)',marginBottom:6,fontSize:15}}>Select a conversation</div>
            <div style={{fontSize:13,color:'var(--muted)'}}>All client messages are isolated — each company sees only their own threads</div>
          </div>
        ) : (
          <>
            <div className="cr-convo-head">
              <div>
                <div className="cr-convo-title">{selThread?.name||'Conversation'}</div>
                <div className="cr-convo-sub">{companies[selThread?.company_id]||''}{selThread?.sales_order_id?' · Order thread':' · General'}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                {selThread?.sales_order_id && <span className="badge b-confirmed" style={{fontSize:'11px'}}>Order</span>}
                {/* Says the state, not just the action -- an archived thread staff
                    can still open needs to announce that the client cannot. */}
                {selThread?.archived_at && <span className="badge" style={{fontSize:'11px',background:'var(--line-2)',color:'var(--ink-2)'}}>Archived · hidden from client</span>}
                <button onClick={()=>toggleArchive(selThread)} disabled={archBusy}
                  title={selThread?.archived_at?'Restore this conversation for the client':'Archive — hides it from the client, keeps it here'}
                  style={{background:'none',border:'1px solid var(--line)',cursor:archBusy?'default':'pointer',color:'var(--ink-2)',borderRadius:'7px',padding:'4px 10px',fontSize:'11.5px',fontWeight:600,letterSpacing:0,opacity:archBusy?.5:1}}>
                  {selThread?.archived_at?'Restore':'Archive'}
                </button>
                {confirmDelId===selThreadId ? (
                  <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <span style={{fontSize:'12px',color:'var(--muted)'}}>Delete this conversation?</span>
                    <button onClick={()=>deleteThread(selThreadId)} style={{background:'var(--hot)',color:'#fff',border:'none',borderRadius:'7px',padding:'5px 11px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>Delete</button>
                    <button onClick={()=>setConfirmDelId(null)} style={{background:'none',border:'1px solid var(--line)',borderRadius:'7px',padding:'5px 11px',fontSize:'12px',fontWeight:600,cursor:'pointer',color:'var(--ink-2)'}}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={()=>setConfirmDelId(selThreadId)} title="Delete conversation" style={{background:'none',border:'none',cursor:'pointer',color:'var(--faint)',display:'flex',alignItems:'center',padding:'6px',borderRadius:'7px',transition:'.12s'}} onMouseEnter={e=>{e.currentTarget.style.background='var(--hot-soft)';e.currentTarget.style.color='var(--hot)';}} onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='var(--faint)';}}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>
                )}
              </div>
            </div>

            <div className="cr-messages">
              {msgsLoading ? <div style={{padding:'40px',textAlign:'center',color:'var(--muted)',fontSize:13}}>Loading…</div> :
               msgs.length===0 ? (
                <div className="cr-empty" style={{paddingTop:40}}>
                  <div style={{fontSize:28,marginBottom:12,opacity:.3}}>💬</div>
                  <p style={{fontSize:13}}>No messages yet — be first to reply</p>
                </div>
              ) : (
                <>
                  {msgs.map((m, i) => {
                    const isClient = m.author_type==='client';
                    const prevSame = i>0 && msgs[i-1].author_type===m.author_type;
                    const nextSame = i<msgs.length-1 && msgs[i+1].author_type===m.author_type;
                    return (
                      <div key={m.id} className={'cr-msg'+(isClient?' from-client':' from-staff')} style={{marginTop:prevSame?3:12}}>
                        {/* Staff messages read 'KUI Team', per Riley: one shared team
                            voice, no per-person labels. author_email is still written
                            on every send -- see the note at the insert -- so this is a
                            DISPLAY choice, and reversing it needs only this expression,
                            with the history intact. See PORTAL.md. */}
                        {!prevSame && <div className="cr-msg-who">{isClient?(m.author_name||companies[m.company_id]||'Client'):(m.author_name||'KUI Team')}</div>}
                        <div className={'cr-msg-bubble'+(prevSame&&!nextSame?' cr-bubble-last':'')+(prevSame?' cr-bubble-mid':'')+(nextSame&&!prevSame?' cr-bubble-first':'')}>{m.body}</div>
                        {!nextSame && <div className="cr-msg-time">{fmtDateTime(m.created_at)}</div>}
                      </div>
                    );
                  })}
                  <div ref={endRef} />
                </>
              )}
            </div>

            {sendErr && (
              <div className="cr-err-bar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>{sendErr}</span>
                <button onClick={send}>Retry →</button>
                <button className="cr-err-dismiss" onClick={()=>setSendErr('')}>×</button>
              </div>
            )}

            <div className="cr-compose">
              <textarea
                ref={draftRef}
                className="cr-compose-input"
                value={draft}
                onChange={e=>{setDraft(e.target.value);if(sendErr)setSendErr('');}}
                placeholder={'Reply to '+(companies[selThread?.company_id]||'client')+'…'}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} }}
                disabled={sending}
                rows={3}
              />
              <div className="cr-compose-foot">
                <span style={{fontSize:11,color:'var(--faint)'}}>Enter ↵ send · Shift+Enter new line</span>
                <button className={'btn btn-dark btn-sm'} onClick={send} disabled={sending||!draft.trim()}>
                  {sending
                    ? <><div style={{width:11,height:11,borderRadius:'50%',border:'2px solid rgba(255,255,255,.3)',borderTopColor:'#fff',animation:'spin .6s linear infinite',flexShrink:0}} />Sending…</>
                    : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Send</>
                  }
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [user,    setUser]    = useState(null);
  const [session, setSession] = useState(null);
  const [rawPage, setRawPage] = useState('programs');
  const [params,  setParams]  = useState({});
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [role,      setRole]      = useState(null);
  const [roleReady, setRoleReady] = useState(false);

  const pageActions = {
    orders:    <button className="btn btn-dark" onClick={()=>setModal('create-po')}>+ New PO</button>,
    companies: <button className="btn btn-dark" onClick={()=>setModal('create-company')}>+ New Company</button>,
    products:  <button className="btn btn-ghost" onClick={()=>navigate('quotes')}>+ New Quote</button>,
    shipments: <button className="btn btn-dark" onClick={()=>setModal('create-shipment')}>+ New Shipment</button>,
  };
  const [modal, setModal] = useState(null);
  const [shipmentsRefresh, setShipmentsRefresh] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [crUnread, setCrUnread] = useState(0);
  const [dreqOpen, setDreqOpen] = useState(0);

  const navigate = (p, pr={}) => { setRawPage(p); setParams(pr); setNavOpen(false); };

  // Look up the signed-in user's staff role. Anything that isn't a clean hit on
  // a limited role — no row, an error, an unknown role — leaves role null, which
  // allowedPagesFor() reads as unrestricted.
  useEffect(() => {
    let cancelled = false;
    const email = user?.email;
    if (!email) { setRole(null); setRoleReady(false); return; }
    (async () => {
      try {
        // ilike can only widen the match (_ and % are wildcards), never narrow
        // it, so re-check the exact address in JS before trusting the row.
        const { data } = await SB.from('staff_profiles').select('email,role').ilike('email', email);
        const row = (data||[]).find(r => (r.email||'').toLowerCase() === email.toLowerCase());
        if (!cancelled) setRole(row ? row.role : null);
      } catch(e) { if (!cancelled) setRole(null); }
      if (!cancelled) setRoleReady(true);
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  // poll unread client messages every 30s
  useEffect(() => {
    // ┌─────────────────────────────────────────────────────────────────────────┐
    // │ FILTERED THE SAME WAY THE PANEL IS, OR THE TWO DISAGREE FOREVER.        │
    // │                                                                         │
    // │ This was a head:true count with no thread awareness at all. Left alone,  │
    // │ archiving a thread with unread messages would clear it from Client       │
    // │ Relations while this nav badge kept counting it -- a number pointing at  │
    // │ a conversation the screen it links to does not show. Two sources of      │
    // │ truth for one dot.                                                       │
    // │                                                                         │
    // │ Costs the exact count: PostgREST cannot join messages to threads, so the │
    // │ rows come back and are filtered here, mirroring loadAll. The volume is   │
    // │ unread client messages only -- tens, not thousands.                      │
    // └─────────────────────────────────────────────────────────────────────────┘
    const fetchUnread = async () => {
      try {
        const [{ data: arch }, { data: rows }] = await Promise.all([
          SB.schema('portal').from('threads').select('id').not('archived_at','is',null),
          SB.schema('portal').from('messages').select('thread_id').eq('author_type','client').eq('read_by_kui',false),
        ]);
        const archived = new Set((arch||[]).map(t=>t.id));
        setCrUnread((rows||[]).filter(m => !archived.has(m.thread_id)).length);
      } catch(e){}
      // Open delivery requests, on the same poll. 'requested' only -- anything
      // answered or withdrawn needs nothing from anyone, and a badge counting
      // those would never reach zero.
      try {
        const { count } = await SB.schema('portal').from('delivery_requests')
          .select('id',{count:'exact',head:true}).eq('status','requested');
        setDreqOpen(count||0);
      } catch(e){}
    };
    fetchUnread();
    const iv = setInterval(fetchUnread, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(()=>{
    // recovery links land back here as #access_token=...&type=recovery
    if (typeof window !== 'undefined' && /type=recovery/.test(window.location.hash)) setRecovery(true);
    SB.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user||null); setSession(session||null); setLoading(false);
    });
    const {data:{subscription}} = SB.auth.onAuthStateChange((event,session)=>{
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUser(session?.user||null); setSession(session||null);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // null = unrestricted. When limited, never render a page outside the allow
  // list, whatever rawPage holds — fall back to the role's first allowed page.
  //
  // Hoisted above the early returns below because the hash effect depends on
  // `page`, and a hook cannot sit after a conditional return. Both lines are
  // pure, so computing them before the guards changes nothing.
  const allowedPages = allowedPagesFor(role);
  const page = (allowedPages && !allowedPages.includes(rawPage)) ? allowedPages[0] : rawPage;

  // Adopt the hash on mount, once. An effect rather than a useState initializer
  // because this route is statically prerendered: the server has no window, so a
  // lazy initializer would produce 'programs' there and the hash value here, and
  // that is a hydration mismatch. A recovery link lands as #access_token=…&
  // type=recovery, which is not a page id, so it falls through to the default
  // and the auth effect above still gets to read it.
  //
  // THE HASH WINS. It describes the URL actually being opened -- a shared link,
  // a bookmark, a back-navigation -- while the store only remembers where this
  // browser was last. When they disagree the URL is the newer intent, so the
  // store is consulted only once the hash has come back with nothing.
  useEffect(() => {
    const p = pageFromHash() || pageFromStore();
    if (p) setRawPage(p);
  }, []);

  // replaceState, not pushState: tab switches must not fill the back stack.
  // Back/forward through tabs is not wired, and would need a popstate listener.
  //
  // Writes the EFFECTIVE page rather than rawPage, so a limited role bounced off
  // a page it cannot see ends up with a hash naming what it is actually looking
  // at instead of what it asked for.
  //
  // Held off until signed in and out of recovery, so neither the login screen
  // nor a password-reset link gets its hash overwritten.
  //
  // Detail pages write NOTHING -- not the hash, not the store. The old code
  // stamped '#so-detail', which nothing could read back, so the URL claimed a
  // location the app would refuse to restore. Writing nothing leaves the parent
  // list's own entry in place, which is what a refresh from a detail view should
  // land on and now does.
  useEffect(() => {
    if (!user || recovery || typeof window === 'undefined') return;
    if (!HASH_PAGES.includes(page)) return;
    const want = '#' + page;
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
    storeTab(page);
  }, [page, user, recovery]);

  if (loading) return <div className="loading" style={{paddingTop:'40vh'}}>Loading...</div>;
  if (recovery) return <ResetPassword onDone={()=>setRecovery(false)} />;
  if (!user)   return <Login />;
  if (!isStaffEmail(user.email)) return <NotStaff user={user} />;
  if (!roleReady) return <div className="loading" style={{paddingTop:'40vh'}}>Loading...</div>;

  const titles = {dashboard:'Insights','sales-orders':'Sales Orders','so-detail':'Sales Order',orders:'Purchase Orders','order-detail':'Purchase Order',companies:'Companies',products:'Products',testing:'Testing & Compliance',pricing:'Pricing & Landed Cost',programs:'Programs',shipments:'Shipments',quotes:'Quotes',codes:'HTS Codes','client-relations':'Client Relations'};
  const badges = {'client-relations': crUnread, 'shipments': dreqOpen};

  return (
    <ToastProvider>
    <div className="app-shell">
      <button className="mobile-menu-btn" aria-label="Open menu" onClick={()=>setNavOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div className={'sidebar-backdrop ' + (navOpen?'show':'')} onClick={()=>setNavOpen(false)} />
      <Sidebar page={page} navigate={navigate} user={user} open={navOpen} badges={badges} allowedPages={allowedPages} />
      <TopBar user={user} title="" taskOpen={taskPanelOpen} onBell={()=>setTaskPanelOpen(p=>!p)} onSettings={()=>navigate('settings')} />
      <TaskPanel open={taskPanelOpen} onClose={()=>setTaskPanelOpen(false)} />
      {page==='quotes' ? (
        <div className="main-area">
          <div className="quotes-root" style={{height:'100%',overflowY:'auto'}}>
            <Quotes session={session} />
          </div>
        </div>
      ) : (
      <div className="main-area">
        {/* codes draws its own heading, like testing — without it here the page
            would show two stacked titles. */}
        <div className="page-header" style={(page==='dashboard'||page==='sales-orders'||page==='so-detail'||page==='order-detail'||page==='testing'||page==='codes'||page==='inventory'||page==='shipments'||page==='pricing'||page==='programs')?{display:'none'}:undefined}>
          <h1 className="page-title">{titles[page]||''}</h1>
          <div className="page-actions">{pageActions[page]}</div>
        </div>
        <div className="page-content" style={page==='dashboard'?{padding:0}:(page==='sales-orders'||page==='so-detail'||page==='order-detail')?{paddingTop:'24px'}:undefined}>
          {page==='dashboard'        && <Dashboard navigate={navigate} />}
          {page==='sales-orders'     && <SalesOrders navigate={navigate} />}
          {page==='so-detail'        && <SalesOrderDetail id={params.id} navigate={navigate} />}
          {page==='orders'           && <Orders navigate={navigate} />}
          {page==='order-detail'     && <OrderDetail id={params.id} navigate={navigate} />}
          {page==='companies'        && <Companies />}
          {page==='products'         && <Products navigate={navigate} canCreateProducts={role !== 'limited_qc'} />}
          {page==='testing'          && <Testing />}
          {page==='codes'            && <Codes canDeleteCodes={role !== 'limited_qc'} />}
          {page==='pricing'          && <Pricing />}
          {page==='programs'         && <Programs userEmail={user?.email||''} />}
          {page==='shipments'        && <Shipments key={shipmentsRefresh} onNewShipment={()=>setModal('create-shipment')} userEmail={user?.email||''} />}
          {page==='inventory'        && <Inventory />}
          {page==='settings'         && <KuiSettings />}
          {page==='client-relations' && <ClientRelations user={user} />}
        </div>
      </div>
      )}
      {modal==='create-po'      && <CreatePOModal onClose={()=>setModal(null)} onCreated={id=>{setModal(null);navigate('order-detail',{id});}} />}
      {modal==='create-company' && <CreateCompanyModal onClose={()=>setModal(null)} onCreated={()=>setModal(null)} />}
      {modal==='create-shipment'&& <CreateShipmentModal onClose={()=>setModal(null)} onCreated={()=>{setModal(null);setShipmentsRefresh(n=>n+1);navigate('shipments');}} />}
    </div>
    </ToastProvider>
  );
}
