import {useLocation} from 'react-router-dom';
import SecondBrain from './SecondBrain';
import {OnlineConsent,OnlineReview} from './OnlineConnection';
export default function AIAssistant(props){const view=new URLSearchParams(useLocation().search).get('view');return view==='connect'?<OnlineConsent/>:view==='review'?<OnlineReview/>:<SecondBrain {...props}/>;}
