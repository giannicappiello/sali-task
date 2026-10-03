import { useParams } from 'react-router-dom';
import ProductSpecificationViewButton from './ProductSpecificationViewButton';
export default function ProductSpecificationPage() {
  const { articleCode } = useParams();
  return <ProductSpecificationViewButton articleCode={articleCode} defaultOpen />;
}
